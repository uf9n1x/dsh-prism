// Row configuration for `dsh-prism/commander` and `dsh-prism/worker`.
//
// The values arrive as untrusted YAML from the profile's patch file, so every
// field is read defensively: a malformed entry is dropped rather than allowed to
// throw during activation, which would take the whole agent preset down. Nothing
// here has a default that points somewhere: no kali.host means no remote backend,
// and the backend keeps reporting itself as unconfigured.
import type { KaliConfig } from '../exec/kali.js'

export interface PrismRowConfig {
  /** Remote execution target. Omit to run local-only. */
  kali?: {
    host?: string
    user?: string
    port?: number
    identityFile?: string
    enabled?: boolean
    strictHostKeyChecking?: boolean
    connectTimeoutSec?: number
  }
  /** Optional engagement root override; relative paths resolve against the session cwd. */
  root?: string
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

const asPort = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : undefined
}

const asSeconds = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 && parsed <= 600 ? parsed : undefined
}

/**
 * Project the row config onto a KaliConfig. Returns undefined when no usable
 * host is present, which keeps the backend in its deny-by-default state.
 */
export function kaliConfigOf(config: unknown): KaliConfig | undefined {
  if (!isObject(config)) return undefined
  const raw = config.kali
  if (!isObject(raw)) return undefined
  const host = asString(raw.host)
  if (host === undefined) return undefined
  const result: KaliConfig = { host }
  const user = asString(raw.user)
  if (user !== undefined) result.user = user
  const port = asPort(raw.port)
  if (port !== undefined) result.port = port
  const identityFile = asString(raw.identityFile)
  if (identityFile !== undefined) result.identityFile = identityFile
  if (raw.enabled === false) result.enabled = false
  if (raw.strictHostKeyChecking === false) result.strictHostKeyChecking = false
  const connectTimeoutSec = asSeconds(raw.connectTimeoutSec)
  if (connectTimeoutSec !== undefined) result.connectTimeoutSec = connectTimeoutSec
  return result
}

/** Engagement root override, if the row asked for one. */
export function rootOverrideOf(config: unknown): string | undefined {
  if (!isObject(config)) return undefined
  return asString(config.root)
}
