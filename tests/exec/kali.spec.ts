import { describe, it, expect } from 'vitest'
import { KaliBackend, type KaliTransport } from '../../src/exec/kali'
import { LocalBackend } from '../../src/exec/local'

describe('P7 optional Kali backend', () => {
  it('is inert when unconfigured and reports unverified (never a fake success)', async () => {
    const kali = new KaliBackend()
    expect(kali.configured).toBe(false)
    const health = await kali.healthCheck()
    expect(health.ok).toBe(false)
    expect(health.verified).toBe(false)
    expect(health.detail).toMatch(/not configured/i)
    await expect(kali.start({ command: 'nmap -sV 10.0.0.5', cwd: process.cwd() })).rejects.toThrow(/not configured/i)
  })

  it('reports unverified when configured but no transport is wired', async () => {
    const kali = new KaliBackend({ host: 'kali.lab', user: 'ops' })
    expect(kali.configured).toBe(true)
    const health = await kali.healthCheck()
    expect(health.ok).toBe(false)
    expect(health.verified).toBe(false)
    expect(health.detail).toMatch(/unverified/i)
    await expect(kali.start({ command: 'id', cwd: process.cwd() })).rejects.toThrow(/unverified/i)
  })

  it('satisfies the backend contract when a transport is injected', async () => {
    const transport: KaliTransport = {
      run: async (command) => ({ code: 0, stdout: `ran:${command}`, stderr: '' })
    }
    const kali = new KaliBackend({ host: 'kali.lab', user: 'ops', identityRef: 'cred:kali-key' }, transport)
    const health = await kali.healthCheck()
    expect(health.verified).toBe(true)
    expect(health.ok).toBe(true)

    const handle = await kali.start({ command: 'whoami', cwd: '/tmp' })
    expect(handle.backend).toBe('kali')
    let out = await kali.output(handle.ref, 0)
    for (let i = 0; i < 20 && out.status === 'running'; i += 1) {
      await new Promise((r) => setTimeout(r, 10))
      out = await kali.output(handle.ref, 0)
    }
    expect(out.chunk).toContain('ran:whoami')
    expect(out.status).toBe('done')
  })

  it('turns a transport failure into a verified failure, not a success', async () => {
    const transport: KaliTransport = {
      run: async () => {
        throw new Error('connection refused')
      }
    }
    const kali = new KaliBackend({ host: 'kali.lab' }, transport)
    const health = await kali.healthCheck()
    expect(health.ok).toBe(false)
    expect(health.verified).toBe(false)
    expect(health.detail).toMatch(/connection failed/i)
  })

  it('the local backend stays healthy and independent of Kali configuration', async () => {
    const local = new LocalBackend()
    const health = await local.healthCheck()
    expect(health.backend).toBe('local')
    expect(health.ok).toBe(true)
  })
})
