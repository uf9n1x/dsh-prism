// Credential materialization for remote execution.
//
// The DSH credentials service hands back a secret VALUE on demand. A secret must
// never reach a prompt, a fact, an evidence row, a log line, or the UI, so this
// module turns a reference into a short-lived private-key file (mode 0600) that
// exists only for the duration of one ssh invocation and is deleted afterwards.
// Nothing here caches: the value is resolved per call and dropped immediately.
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The slice of the DSH credentials service Prism needs. Never returns a cached value. */
export interface CredentialResolver {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>
  describe?(ref: string): { configured: boolean; source: string; writable: boolean }
}

export interface ResolvedIdentity {
  /** Path to a temporary private-key file. The caller must delete it when done. */
  identityFile: string
  cleanup(): Promise<void>
}

/**
 * Resolve a credential reference to a private-key file on disk.
 *
 * Throws (fail-closed) when the reference cannot be resolved: a configured
 * `identityRef` with no usable secret must stop the connection, not silently fall
 * back to password/agent auth. The secret is written to a 0600 temp file and is
 * never returned, logged, or embedded in any record.
 */
export async function materializeIdentity(ref: string, resolver: CredentialResolver): Promise<ResolvedIdentity> {
  const resolved = await resolver.resolve(ref)
  if (resolved === undefined || typeof resolved.value !== 'string' || resolved.value.length === 0) {
    throw new Error(`credential "${ref}" is not configured or could not be resolved; refusing to connect`)
  }
  const dir = await mkdtemp(join(tmpdir(), 'prism-id-'))
  const identityFile = join(dir, 'identity')
  await writeFile(identityFile, resolved.value, { encoding: 'utf8', mode: 0o600 })
  // A permissive umask can widen the mode; tighten explicitly where the platform
  // honours it. On Windows this is a no-op, which is fine — the file is short-lived.
  await chmod(identityFile, 0o600).catch(() => undefined)
  return {
    identityFile,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
