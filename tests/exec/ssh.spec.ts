// SshTransport is the only place a remote command string reaches a remote shell.
// These tests pin the argv shape (so an injection cannot be introduced by
// refactor) and the failure modes that must stay honest: a timeout reports no
// exit code, and a missing host stays `unverified` rather than pretending.
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createKaliBackend, SshTransport, assertSshTarget, sshArgs, type SshTarget } from '../../src/exec/ssh.js'

/** Minimal ChildProcess stand-in: enough surface for SshTransport.run. */
function fakeChild(behaviour: { code?: number | null; stdout?: string; stderr?: string; hang?: boolean; error?: Error }) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: (encoding: string) => void }
    stderr: EventEmitter & { setEncoding: (encoding: string) => void }
    kill: (signal?: string) => boolean
    killed: boolean
  }
  // The transport sets an encoding for utf8 chunks; a real stream has this.
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => undefined })
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: () => undefined })
  child.killed = false
  child.kill = () => {
    child.killed = true
    return true
  }
  setImmediate(() => {
    if (behaviour.error !== undefined) {
      child.emit('error', behaviour.error)
      return
    }
    if (behaviour.hang === true) return
    if (behaviour.stdout !== undefined) child.stdout.emit('data', behaviour.stdout)
    if (behaviour.stderr !== undefined) child.stderr.emit('data', behaviour.stderr)
    child.emit('close', behaviour.code ?? 0)
  })
  return child
}

const argvOf = (target: SshTarget, command = 'uname -a'): string[] => sshArgs(target, command)

describe('ssh argv construction', () => {
  it('starts non-interactive and keeps host-key checking on by default', () => {
    const args = argvOf({ host: '10.0.0.9' })
    expect(args).toContain('BatchMode=yes')
    expect(args).toContain('StrictHostKeyChecking=yes')
    expect(args).toContain('ConnectTimeout=10')
  })

  it('passes the destination and the command as separate argv entries after --', () => {
    const args = argvOf({ host: 'kali.lab', user: 'user' }, 'nmap -sT 10.0.0.0/30')
    const dashDash = args.indexOf('--')
    expect(dashDash).toBeGreaterThan(-1)
    expect(args[dashDash + 1]).toBe('user@kali.lab')
    expect(args[dashDash + 2]).toBe('nmap -sT 10.0.0.0/30')
    // The command must be exactly one entry: splitting it would let the local
    // side interpret metacharacters that belong to the far side.
    expect(args.filter((a) => a.includes('nmap'))).toHaveLength(1)
  })

  it('carries port and identity file as their own options', () => {
    const args = argvOf({ host: '10.0.0.9', port: 2222, identityFile: '/home/user/.ssh/id_ed25519' })
    expect(args[args.indexOf('-p') + 1]).toBe('2222')
    expect(args[args.indexOf('-i') + 1]).toBe('/home/user/.ssh/id_ed25519')
  })

  it('drops the host-key check only when explicitly told to', () => {
    expect(argvOf({ host: '10.0.0.9', strictHostKeyChecking: false })).toContain('StrictHostKeyChecking=no')
    expect(argvOf({ host: '10.0.0.9', strictHostKeyChecking: true })).toContain('StrictHostKeyChecking=yes')
  })

  it('rejects a host that would be parsed as an ssh option', () => {
    // This is the reason the host pattern forbids a leading dash: without it
    // ssh would read -oProxyCommand=… as an option and run a local command.
    expect(() => assertSshTarget({ host: '-oProxyCommand=calc.exe' })).toThrow(/plain hostname/)
  })

  it('rejects shell metacharacters and separators in host or user', () => {
    for (const host of ['10.0.0.9;whoami', 'host$(id)', 'a b', 'h|nc', 'h\nx']) {
      expect(() => assertSshTarget({ host }), host).toThrow(/plain hostname/)
    }
    for (const user of ['user@evil', 'user;id', 'user user', '-oX']) {
      expect(() => assertSshTarget({ host: 'h', user }), user).toThrow(/plain account name/)
    }
  })

  it('rejects an out-of-range port and an empty command', () => {
    expect(() => assertSshTarget({ host: 'h', port: 0 })).toThrow(/port/)
    expect(() => assertSshTarget({ host: 'h', port: 70000 })).toThrow(/port/)
    expect(() => sshArgs({ host: 'h' }, '   ')).toThrow(/command is empty/)
  })
})

describe('SshTransport run', () => {
  it('returns stdout, stderr and the exit code of a finished remote command', async () => {
    const transport = new SshTransport({ host: '10.0.0.9' }, (() =>
      fakeChild({ code: 0, stdout: 'Linux kali 6.6\n', stderr: '' })) as never)
    const result = await transport.run('uname -a', 5000)
    expect(result).toEqual({ code: 0, stdout: 'Linux kali 6.6\n', stderr: '' })
  })

  it('reports a non-zero exit code instead of throwing', async () => {
    const transport = new SshTransport({ host: '10.0.0.9' }, (() =>
      fakeChild({ code: 127, stdout: '', stderr: 'bash: nmap: command not found\n' })) as never)
    const result = await transport.run('nmap', 5000)
    expect(result.code).toBe(127)
    expect(result.stderr).toContain('command not found')
  })

  it('kills a hung remote command and reports no exit code', async () => {
    const spawned: { killed: boolean }[] = []
    const transport = new SshTransport({ host: '10.0.0.9' }, ((...args: unknown[]) => {
      const child = fakeChild({ hang: true })
      spawned.push(child)
      void args
      return child
    }) as never)
    const result = await transport.run('sleep 600', 1000)
    expect(result.code).toBeNull()
    expect(result.stderr).toContain('ssh timeout')
    expect(spawned[0]!.killed).toBe(true)
  })

  it('surfaces a spawn failure as an error, not a silent success', async () => {
    const transport = new SshTransport({ host: '10.0.0.9' }, (() =>
      fakeChild({ error: new Error('spawn ssh ENOENT') })) as never)
    await expect(transport.run('uname', 5000)).rejects.toThrow(/could not start/)
  })
})

describe('createKaliBackend', () => {
  it('stays unverified when no host is configured, and never dials out', async () => {
    const health = await createKaliBackend({}).healthCheck()
    expect(health).toMatchObject({ backend: 'kali', ok: false, verified: false })
    expect(health.detail).toContain('not configured')
  })

  it('stays unverified when explicitly disabled even with a host', async () => {
    const health = await createKaliBackend({ host: '10.0.0.9', enabled: false }).healthCheck()
    expect(health.verified).toBe(false)
  })

  it('really dials when a host is configured, and reports the real failure', async () => {
    // TEST-NET-1 is guaranteed unroutable; a 1s ceiling keeps the test honest
    // and fast. The point is that it tries and then tells the truth.
    const health = await createKaliBackend({ host: '192.0.2.1', connectTimeoutSec: 1 }).healthCheck()
    expect(health.ok).toBe(false)
    expect(health.verified).toBe(false)
    // The detail must carry ssh's own diagnostic, not a canned string.
    expect(health.detail).toMatch(/exited 255|connection failed|could not start/)
    expect(health.detail).toMatch(/ssh:/)
  }, 20_000)

  it('refuses start() before a transport exists', async () => {
    await expect(createKaliBackend({}).start({ command: 'id', cwd: '/' })).rejects.toThrow(/not configured/)
  })
})
