import { describe, it, expect } from 'vitest'
import { targetsInCommand, targetInScope, firstOutOfScope, ipv4InCidr } from '../../src/domain/scope'

describe('target extraction from a command line', () => {
  it('reads a bare address, a URL host and an ssh destination', () => {
    expect(targetsInCommand('nmap -sT -p 22,80 10.0.0.5')).toEqual(['10.0.0.5'])
    expect(targetsInCommand('curl -s http://192.0.2.10:8080/login.php')).toEqual(['192.0.2.10'])
    expect(targetsInCommand('ssh -o BatchMode=yes user@192.0.2.10 uname -a')).toContain('192.0.2.10')
  })

  it('keeps the CIDR suffix when one is written, and de-duplicates repeats', () => {
    expect(targetsInCommand('nmap 10.0.0.0/24 --exclude 10.0.0.1')).toEqual(['10.0.0.0/24', '10.0.0.1'])
    expect(targetsInCommand('curl http://10.0.0.5 && curl http://10.0.0.5/x')).toEqual(['10.0.0.5'])
  })

  it('returns nothing for a purely local command, so scope is not invented', () => {
    expect(targetsInCommand('whoami')).toEqual([])
    expect(targetsInCommand('echo prism-exec-ok')).toEqual([])
    expect(targetsInCommand('')).toEqual([])
  })

  it('rejects impossible octets instead of treating them as hosts', () => {
    expect(targetsInCommand('nmap 999.1.1.1')).toEqual([])
  })
})

describe('mandate scope matching', () => {
  it('matches exact hosts and addresses', () => {
    expect(targetInScope('10.0.0.5', ['10.0.0.5'])).toBe(true)
    expect(targetInScope('10.0.0.6', ['10.0.0.5'])).toBe(false)
  })

  it('matches an address inside a CIDR', () => {
    expect(ipv4InCidr('10.0.0.5', '10.0.0.0/24')).toBe(true)
    expect(ipv4InCidr('10.0.1.5', '10.0.0.0/24')).toBe(false)
    expect(targetInScope('10.0.0.5', ['10.0.0.0/24'])).toBe(true)
  })

  it('matches a wildcard domain but not the bare suffix', () => {
    expect(targetInScope('api.example.com', ['*.example.com'])).toBe(true)
    expect(targetInScope('example.com', ['*.example.com'])).toBe(false)
  })

  it('treats loopback as local, never as a remote target', () => {
    expect(targetInScope('127.0.0.1', ['10.0.0.5'])).toBe(true)
    expect(targetInScope('localhost', [])).toBe(true)
  })

  it('reports the first endpoint outside the list', () => {
    expect(firstOutOfScope(['10.0.0.5', '10.0.0.9'], ['10.0.0.5'])).toBe('10.0.0.9')
    expect(firstOutOfScope(['10.0.0.5'], ['10.0.0.5'])).toBeNull()
  })
})
