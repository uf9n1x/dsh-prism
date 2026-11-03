// T3: an identityRef must resolve through the credentials service at connect
// time, never be cached, never be written anywhere durable, and never surface in
// argv, logs, health details or the UI. A reference that cannot be resolved must
// fail closed (no dial), never fall back to another auth mode.
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createKaliBackend } from '../../src/exec/ssh.js'
import { materializeIdentity, type CredentialResolver } from '../../src/exec/credential.js'

function fakeChild(behaviour: { code?: number | null; stdout?: string; stderr?: string }) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: (encoding: string) => void }
    stderr: EventEmitter & { setEncoding: (encoding: string) => void }
    kill: (signal?: string) => boolean
  }
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => undefined })
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: () => undefined })
  child.kill = () => true
  setImmediate(() => {
    if (behaviour.stdout !== undefined) child.stdout.emit('data', behaviour.stdout)
    if (behaviour.stderr !== undefined) child.stderr.emit('data', behaviour.stderr)
    child.emit('close', behaviour.code ?? 0)
  })
  return child
}

describe('T3 materializeIdentity', () => {
  it('writes the secret to a temp key file and deletes it on cleanup', async () => {
    const resolver: CredentialResolver = { resolve: async () => ({ value: 'PRIVATE-KEY-MATERIAL', source: 'vault' }) }
    const material = await materializeIdentity('vault:deploy-key', resolver)
    expect(existsSync(material.identityFile)).toBe(true)
    expect(readFileSync(material.identityFile, 'utf8')).toBe('PRIVATE-KEY-MATERIAL')
    await material.cleanup()
    expect(existsSync(material.identityFile)).toBe(false)
  })

  it('throws when the reference cannot be resolved', async () => {
    await expect(materializeIdentity('vault:missing', { resolve: async () => undefined })).rejects.toThrow(
      /not configured|could not be resolved/
    )
  })
})

describe('T3 createKaliBackend resolves identityRef lazily and fails closed', () => {
  it('does not resolve or write the key until a connection is attempted', () => {
    let resolved = 0
    createKaliBackend(
      { host: '10.0.0.9', identityRef: 'vault:lab' },
      {
        credentials: {
          resolve: async () => {
            resolved += 1
            return { value: 'K', source: 'vault' }
          }
        }
      }
    )
    // Merely building the backend must not touch the credentials service.
    expect(resolved).toBe(0)
  })

  it('fails closed with no dial when the credential is unresolvable', async () => {
    let spawned = 0
    const backend = createKaliBackend(
      { host: '10.0.0.9', identityRef: 'vault:missing' },
      {
        credentials: { resolve: async () => undefined },
        spawnFn: (() => {
          spawned += 1
          return fakeChild({ code: 0 })
        }) as never
      }
    )
    const health = await backend.healthCheck()
    expect(health.ok).toBe(false)
    expect(health.verified).toBe(false)
    expect(health.detail).toMatch(/not configured|could not be resolved/)
    expect(spawned).toBe(0)
  })

  it('refuses to dial when identityRef is set but no credentials service exists', async () => {
    let spawned = 0
    const backend = createKaliBackend(
      { host: '10.0.0.9', identityRef: 'vault:x' },
      {
        spawnFn: (() => {
          spawned += 1
          return fakeChild({ code: 0 })
        }) as never
      }
    )
    const health = await backend.healthCheck()
    expect(health.verified).toBe(false)
    expect(health.detail).toMatch(/no credentials service/)
    expect(spawned).toBe(0)
  })

  it('hands ssh a temp key path, never the secret, and removes the key afterwards', async () => {
    const SECRET = 'TOP-SECRET-KEY-0123456789'
    const seen: string[][] = []
    const backend = createKaliBackend(
      { host: '10.0.0.9', user: 'user', identityRef: 'vault:lab' },
      {
        credentials: { resolve: async () => ({ value: SECRET, source: 'vault' }) },
        spawnFn: ((_cmd: string, args: string[]) => {
          seen.push(args)
          return fakeChild({ code: 0, stdout: 'Linux ok\n' })
        }) as never
      }
    )
    const health = await backend.healthCheck()
    expect(health.verified).toBe(true)
    const argv = seen[0]!
    expect(argv.join(' ')).not.toContain(SECRET)
    const keyPath = argv[argv.indexOf('-i') + 1]!
    expect(keyPath.length).toBeGreaterThan(0)
    expect(existsSync(keyPath)).toBe(false) // deleted in the finally
    expect(health.detail).not.toContain(SECRET)
  })
})
