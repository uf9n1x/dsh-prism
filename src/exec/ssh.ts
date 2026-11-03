// SshTransport — the concrete KaliTransport, backed by the system OpenSSH client.
//
// Why the system client and not a library: the bundle ships with zero runtime
// dependencies (D16), and every host that can reach a pentest VM already has
// ssh. The transport never builds a shell string of its own: the destination and
// the command are separate argv entries, so a hostile target name cannot smuggle
// extra ssh options, and the remote command is interpreted by the far-side shell
// exactly once (which is the documented behaviour of `ssh host command`).
//
// Nothing here decides policy. Whether a command may run at all is the engine's
// authorize() call, checked before start() is ever reached.
import { spawn } from 'node:child_process'
import { KaliBackend, type KaliConfig, type KaliTransport } from './kali.js'
import { materializeIdentity, type CredentialResolver } from './credential.js'

export interface SshTarget {
  host: string
  user?: string
  port?: number
  /** Path to a private key. Resolved by the caller from the credentials service. */
  identityFile?: string
  /**
   * `false` keeps the strict default. This exists for lab VMs with rotated host
   * keys; it is never the default because it removes the MITM check.
   */
  strictHostKeyChecking?: boolean
  connectTimeoutSec?: number
}

export interface SshResult {
  code: number | null
  stdout: string
  stderr: string
}

type SpawnFn = typeof spawn

const HOST_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/
const USER_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/
const DEFAULT_CONNECT_TIMEOUT_SEC = 10

/**
 * Reject anything that is not a plain hostname or dotted-quad address. A leading
 * `-` is disallowed by the pattern itself, which matters: otherwise a "host" like
 * `-oProxyCommand=...` would be parsed by ssh as an option, not a destination.
 */
export function assertSshTarget(target: SshTarget): void {
  if (typeof target.host !== 'string' || target.host.trim() === '') {
    throw new Error('ssh target has no host')
  }
  if (!HOST_PATTERN.test(target.host)) {
    throw new Error(`ssh target host is not a plain hostname or IP: ${JSON.stringify(target.host)}`)
  }
  if (target.user !== undefined && !USER_PATTERN.test(target.user)) {
    throw new Error(`ssh target user is not a plain account name: ${JSON.stringify(target.user)}`)
  }
  if (target.port !== undefined && (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535)) {
    throw new Error(`ssh target port is out of range: ${String(target.port)}`)
  }
  if (target.identityFile !== undefined && target.identityFile.trim() === '') {
    throw new Error('ssh target identityFile is empty')
  }
}

/** Build argv. Pure on purpose: the injection guards are asserted in tests. */
export function sshArgs(target: SshTarget, command: string): string[] {
  assertSshTarget(target)
  if (typeof command !== 'string' || command.trim() === '') {
    throw new Error('ssh command is empty')
  }
  const args: string[] = [
    '-o',
    'BatchMode=yes',
    '-o',
    `StrictHostKeyChecking=${target.strictHostKeyChecking === false ? 'no' : 'yes'}`,
    '-o',
    `ConnectTimeout=${String(target.connectTimeoutSec ?? DEFAULT_CONNECT_TIMEOUT_SEC)}`,
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=4'
  ]
  if (target.port !== undefined) args.push('-p', String(target.port))
  if (target.identityFile !== undefined) args.push('-i', target.identityFile)
  const destination = target.user === undefined ? target.host : `${target.user}@${target.host}`
  // `--` ends option parsing so a destination can never be read as a flag.
  args.push('--', destination, command)
  return args
}

export class SshTransport implements KaliTransport {
  private readonly target: SshTarget
  private readonly spawnFn: SpawnFn

  constructor(target: SshTarget, spawnFn: SpawnFn = spawn) {
    assertSshTarget(target)
    this.target = target
    this.spawnFn = spawnFn
  }

  async run(command: string, timeoutMs: number): Promise<SshResult> {
    const args = sshArgs(this.target, command)
    return await new Promise<SshResult>((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const child = this.spawnFn('ssh', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      const finish = (result: SshResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => {
        // Timeout is a normal outcome for a hung remote command, not a crash:
        // report it as "no exit code" and let the caller mark the record failed.
        child.kill('SIGKILL')
        finish({ code: null, stdout, stderr: `${stderr}\n[ssh timeout after ${String(timeoutMs)}ms]`.trim() })
      }, Math.max(1000, timeoutMs))
      timer.unref?.()
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk
      })
      child.on('error', (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(`ssh could not start: ${error.message}`))
      })
      child.on('close', (code: number | null) => {
        finish({ code, stdout, stderr })
      })
    })
  }
}

/**
 * A KaliTransport that resolves an `identityRef` through the credentials service
 * at call time and never stores the secret anywhere durable.
 *
 * - With no `identityRef`, it behaves exactly like a plain SshTransport (an
 *   `identityFile` path, if given, is used directly).
 * - With an `identityRef` but no credentials service it refuses before spawning:
 *   a configured reference that cannot be resolved must fail closed, never fall
 *   back to password/agent auth.
 * - The temporary key file is created for this one invocation and deleted in a
 *   `finally`, so a crash does not leave the key on disk.
 */
export class CredentialSshTransport implements KaliTransport {
  constructor(
    private readonly config: KaliConfig,
    private readonly resolver: CredentialResolver | undefined,
    private readonly spawnFn: SpawnFn = spawn
  ) {}

  private baseTarget(): SshTarget {
    return {
      host: this.config.host ?? '',
      user: this.config.user,
      port: this.config.port,
      identityFile: this.config.identityFile,
      strictHostKeyChecking: this.config.strictHostKeyChecking,
      connectTimeoutSec: this.config.connectTimeoutSec
    }
  }

  async run(command: string, timeoutMs: number): Promise<SshResult> {
    const target = this.baseTarget()
    let cleanup: (() => Promise<void>) | undefined
    if (this.config.identityRef !== undefined) {
      if (this.resolver === undefined) {
        throw new Error(`identityRef "${this.config.identityRef}" is set but no credentials service is available; refusing to connect`)
      }
      const material = await materializeIdentity(this.config.identityRef, this.resolver)
      target.identityFile = material.identityFile
      cleanup = material.cleanup
    }
    try {
      return await new SshTransport(target, this.spawnFn).run(command, timeoutMs)
    } finally {
      if (cleanup !== undefined) await cleanup()
    }
  }
}

/**
 * Build the Kali backend for a configuration. A host is required to get a real
 * transport: without one the backend keeps saying `unverified` instead of
 * pretending it could reach something. This function never invents an address.
 * `deps.credentials` is the DSH credentials service used to resolve `identityRef`;
 * `deps.spawnFn` is a test seam.
 */
export function createKaliBackend(
  config: KaliConfig = {},
  deps: { credentials?: CredentialResolver; spawnFn?: SpawnFn } = {}
): KaliBackend {
  const enabled = config.enabled !== false
  const host = config.host
  if (enabled && typeof host === 'string' && host.trim() !== '') {
    return new KaliBackend(config, new CredentialSshTransport(config, deps.credentials, deps.spawnFn ?? spawn))
  }
  return new KaliBackend(config)
}
