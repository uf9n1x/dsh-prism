// Shared session working-directory resolution.
//
// The tool surface (`src/host/tools.ts`) and the read-only view route
// (`src/host/webrow.ts`) MUST agree on which `.prism/` is "the" engagement for a
// session. They used to differ: `cwdOf` preferred the live `workingDirectory`
// service while `createSessionResolver` preferred the immutable `header.cwd`, so
// after an operator switched into a sub-directory the panel read a different,
// frozen `.prism/` — the graph looked frozen while real work continued elsewhere
// (BUG-001). Both now resolve through this single helper.

/**
 * The live working directory of a session, from the host `workingDirectory`
 * service. Returns null when the service is absent, throws, or answers nothing
 * (callers then fall back to the immutable header / persistence, or to a
 * caller-supplied cwd).
 */
export function liveSessionCwd(ctx: any, session: any): string | null {
  if (session === undefined || session === null) return null
  try {
    const wd = ctx?.get?.('workingDirectory') ?? ctx?.workingDirectory
    if (wd === undefined || wd === null || typeof wd.get !== 'function') return null
    const dir = wd.get(session)
    return typeof dir === 'string' && dir.length > 0 ? dir : null
  } catch {
    return null
  }
}
