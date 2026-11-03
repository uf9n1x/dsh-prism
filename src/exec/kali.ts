// KaliBackend — optional remote execution over SSH.
//
// The contract is identical to LocalBackend so a worker cannot tell them apart
// above the interface. This build ships configuration, health checking and the
// deny-by-default path; it does **not** claim a working remote transport. When
// no host is configured, or the far side cannot be reached, every result says
// `unverified` and `start` refuses — a simulated success here would be worse
// than a missing feature.
import { randomUUID } from 'node:crypto'
import type { ExecutionBackend, ExecHandle, ExecRequest, HealthStatus, OutputChunk } from './backend.js'

export interface KaliConfig {
  host?: string
  user?: string
  port?: number
  /** Credential reference resolved by the DSH credentials service — never a secret value. */
  identityRef?: string
  enabled?: boolean
  /** Private key path, already resolved from identityRef. Never the key itself. */
  identityFile?: string
  /** Only `false` for lab VMs with rotated host keys; the default keeps the MITM check. */
  strictHostKeyChecking?: boolean
  connectTimeoutSec?: number
}

export class KaliBackend implements ExecutionBackend {
  readonly kind = 'kali' as const
  private readonly config: KaliConfig
  private readonly transport: KaliTransport | undefined
  private readonly jobs = new Map<string, { buffer: string; status: 'running' | 'done' | 'failed' | 'stopped'; exitCode: number | null }>()

  constructor(config: KaliConfig = {}, transport?: KaliTransport) {
    this.config = config
    this.transport = transport
  }

  get configured(): boolean {
    return this.config.enabled !== false && typeof this.config.host === 'string' && this.config.host.length > 0
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.configured) {
      return { backend: 'kali', ok: false, verified: false, detail: 'not configured (no kali.host); local backend unaffected' }
    }
    if (this.transport === undefined) {
      return {
        backend: 'kali',
        ok: false,
        verified: false,
        detail: 'configured but no SSH transport is wired in this build; status is unverified'
      }
    }
    try {
      const probe = await this.transport.run('uname -a', 10_000)
      const ok = probe.code === 0
      return {
        backend: 'kali',
        ok,
        // `verified` means a real round trip succeeded. A connection that is
        // attempted but fails (255, timeout, no binary) leaves this false: the
        // backend is still unproven, even though we now know more about why.
        verified: ok,
        detail: ok ? probe.stdout.trim().slice(0, 200) : `remote command exited ${String(probe.code)}: ${probe.stderr.trim().slice(0, 160)}`
      }
    } catch (err) {
      return { backend: 'kali', ok: false, verified: false, detail: `connection failed: ${(err as Error).message}` }
    }
  }

  async start(request: ExecRequest): Promise<ExecHandle> {
    if (!this.configured) throw new Error('kali backend is not configured; use the local backend')
    if (this.transport === undefined) {
      throw new Error('kali backend is configured but has no wired transport in this build (unverified)')
    }
    const ref = `kali-${randomUUID()}`
    const record: { buffer: string; status: 'running' | 'done' | 'failed' | 'stopped'; exitCode: number | null } = {
      buffer: '',
      status: 'running',
      exitCode: null
    }
    this.jobs.set(ref, record)
    void this.transport
      .run(request.command, request.timeoutMs ?? 600_000)
      .then((result) => {
        record.buffer += result.stdout + result.stderr
        record.exitCode = result.code
        this.jobs.set(ref, { ...record, status: result.code === 0 ? 'done' : 'failed' })
      })
      .catch((err: Error) => {
        this.jobs.set(ref, { buffer: `[kali error] ${err.message}`, status: 'failed', exitCode: null })
      })
    return { ref, backend: 'kali', started_at: new Date().toISOString() }
  }

  async output(ref: string, cursor: number): Promise<OutputChunk> {
    const job = this.jobs.get(ref)
    if (job === undefined) {
      return { chunk: '', cursor, status: 'failed', exit_code: null, truncated: false }
    }
    const chunk = job.buffer.slice(Math.max(0, cursor))
    return {
      chunk,
      cursor: Math.max(0, cursor) + chunk.length,
      status: job.status,
      exit_code: job.exitCode,
      truncated: false
    }
  }

  async stop(ref: string): Promise<void> {
    const job = this.jobs.get(ref)
    if (job === undefined) return
    if (job.status === 'running') this.jobs.set(ref, { ...job, status: 'stopped' })
  }
}

/** Minimal transport seam so a real SSH/MCP adapter can be injected and tested. */
export interface KaliTransport {
  run(command: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }>
}
