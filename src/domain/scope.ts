// Target extraction and scope matching.
//
// A mandate's `targets` used to be declarative only: `authorize()` checked a
// target when the caller passed one, and `execStart` never did, so the list in
// the credential had no effect on what actually ran. This module closes that:
// it reads the endpoints out of a command line and answers whether every one of
// them is inside the mandate.
//
// It is deliberately conservative in one direction and honest in the other:
//   - anything it can recognise as an endpoint must match, or the command is
//     refused before a process starts;
//   - a command with no recognisable endpoint is allowed through, because a
//     local `whoami` is not a scope violation. That residual gap is documented
//     in README §8 rather than papered over.

const IPV4 = /(?<![\w.-])((?:\d{1,3}\.){3}\d{1,3})(?:\/(\d{1,2}))?(?![\w.-])/g
const URL_PATTERN = /\bhttps?:\/\/[^\s'"`<>]+/gi
/** `ssh://user@host:port` and plain `user@host` (host part only). */
const USER_AT_HOST = /(?:^|\s)[\w.-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})(?=[:/\s]|$)/g

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

/** Parse one dotted quad to an unsigned 32-bit number, or null when invalid. */
export function ipv4ToInt(value: string): number | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  let out = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    out = (out << 8) | n
  }
  return out >>> 0
}

function maskOf(bits: number): number {
  if (bits <= 0) return 0
  if (bits >= 32) return 0xffffffff
  return (0xffffffff << (32 - bits)) >>> 0
}

/** Whether an IPv4 address sits inside a `a.b.c.d/nn` range. */
export function ipv4InCidr(address: string, cidr: string): boolean {
  const [base, bitsText] = cidr.split('/')
  if (bitsText === undefined) return false
  const ip = ipv4ToInt(address)
  const network = ipv4ToInt(base ?? '')
  const bits = Number(bitsText)
  if (ip === null || network === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
  const mask = maskOf(bits)
  return (ip & mask) >>> 0 === (network & mask) >>> 0
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

/** Hostname from a URL, without credentials, port or path. */
function hostOfUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    return url.hostname === '' ? null : normalize(url.hostname.replace(/^\[|\]$/g, ''))
  } catch {
    return null
  }
}

/**
 * Endpoints a command line names. Returns normalized hosts and IPv4/CIDR
 * literals, de-duplicated, grouped by source: URL hosts first, then bare
 * addresses, then `user@host`. Order inside a group is the order of appearance;
 * order across groups is not, so callers must not read meaning into it.
 */
export function targetsInCommand(command: string): string[] {
  const text = String(command ?? '')
  const found: string[] = []
  const seen = new Set<string>()
  const push = (value: string): void => {
    const key = normalize(value)
    if (key === '' || seen.has(key)) return
    seen.add(key)
    found.push(key)
  }

  for (const match of text.matchAll(URL_PATTERN)) {
    const host = hostOfUrl(match[0])
    if (host !== null) push(host)
  }
  for (const match of text.matchAll(IPV4)) {
    const address = match[1] ?? ''
    if (ipv4ToInt(address) === null) continue
    push(match[2] === undefined ? address : `${address}/${match[2]}`)
  }
  for (const match of text.matchAll(USER_AT_HOST)) {
    const host = match[1] ?? ''
    if (host !== '') push(host)
  }
  return found
}

/**
 * Is one endpoint inside the mandate's target list?
 *
 * Accepted forms in the scope: an exact host or IP, an IPv4 CIDR, or a
 * `*.example.com` wildcard. Loopback is always inside: it is this machine, not
 * a remote target, and refusing it would break ordinary local tooling.
 */
export function targetInScope(candidate: string, scope: readonly string[]): boolean {
  const value = normalize(candidate)
  if (value === '') return false
  if (LOOPBACK.has(value)) return true
  const asIp = ipv4ToInt(value)
  for (const entryRaw of scope) {
    const entry = normalize(entryRaw)
    if (entry === value) return true
    if (asIp !== null && entry.includes('/') && ipv4InCidr(value, entry)) return true
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1)
      if (value.endsWith(suffix) && value.length > suffix.length) return true
    }
  }
  return false
}

/** First endpoint outside the scope, or null when everything is covered. */
export function firstOutOfScope(targets: readonly string[], scope: readonly string[]): string | null {
  for (const target of targets) {
    if (!targetInScope(target, scope)) return target
  }
  return null
}
