// Row config is untrusted YAML: a typo must degrade the backend, never break
// activation of the whole agent preset.
import { describe, expect, it } from 'vitest'
import { kaliConfigOf, rootOverrideOf } from '../../src/host/config.js'

describe('kaliConfigOf', () => {
  it('returns undefined when there is no usable host', () => {
    expect(kaliConfigOf(undefined)).toBeUndefined()
    expect(kaliConfigOf(null)).toBeUndefined()
    expect(kaliConfigOf({})).toBeUndefined()
    expect(kaliConfigOf({ kali: {} })).toBeUndefined()
    expect(kaliConfigOf({ kali: { host: '   ' } })).toBeUndefined()
    expect(kaliConfigOf({ kali: { host: 42 } })).toBeUndefined()
    expect(kaliConfigOf({ kali: 'kali.lab' })).toBeUndefined()
  })

  it('keeps every valid field', () => {
    expect(
      kaliConfigOf({
        kali: {
          host: '192.0.2.10',
          user: 'user',
          port: 2222,
          identityFile: '/home/user/.ssh/id_ed25519',
          strictHostKeyChecking: false,
          connectTimeoutSec: 8
        }
      })
    ).toEqual({
      host: '192.0.2.10',
      user: 'user',
      port: 2222,
      identityFile: '/home/user/.ssh/id_ed25519',
      strictHostKeyChecking: false,
      connectTimeoutSec: 8
    })
  })

  it('drops malformed values instead of forwarding them', () => {
    const config = kaliConfigOf({
      kali: { host: 'kali.lab', port: 99999, connectTimeoutSec: -3, user: '', identityFile: '' }
    })
    expect(config).toEqual({ host: 'kali.lab' })
  })

  it('carries an explicit disable through, so a host can be parked', () => {
    expect(kaliConfigOf({ kali: { host: 'kali.lab', enabled: false } })).toMatchObject({ enabled: false })
  })

  it('never invents a default host', () => {
    // The absence of config is the safe state; a default here would mean the
    // bundle dials out to an address nobody chose.
    expect(kaliConfigOf({ kali: { user: 'user' } })).toBeUndefined()
  })
})

describe('rootOverrideOf', () => {
  it('returns a trimmed path only when a non-empty string is given', () => {
    expect(rootOverrideOf({ root: '  .prism-acme  ' })).toBe('.prism-acme')
    expect(rootOverrideOf({ root: '' })).toBeUndefined()
    expect(rootOverrideOf({})).toBeUndefined()
    expect(rootOverrideOf('nope')).toBeUndefined()
  })
})
