// Read-only HTTP views of `.prism/` for the web client.
//
// The five views are served as same-origin JSON instead of a typert `@Remote`
// surface: generating a Remote contract needs the DSH monorepo's `build:lib`
// codegen, which an out-of-tree bundle cannot run (see D22). The route is
// strictly read-only, session-scoped, and never accepts a path from the client.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { PrismEngine } from '../engine/engine.js'
import { buildBoard, buildEvidence, buildGraph, buildReport, buildWorkers } from '../projection/readmodel.js'
import { redactSecrets } from '../projection/untrusted.js'

/** The five views of SPEC §P8, plus the board the commander reads. */
export const VIEW_NAMES = ['board', 'graph', 'frontier', 'workers', 'evidence', 'report'] as const
export type ViewName = (typeof VIEW_NAMES)[number]

export const ROUTE_PATH = '/prism/view'

export interface ViewOk {
  ok: true
  view: ViewName
  generated_at: string
  payload: unknown
}

export interface ViewError {
  ok: false
  code: 'bad-method' | 'bad-view' | 'bad-session' | 'no-engagement' | 'internal'
  message: string
}

export function isViewName(value: string): value is ViewName {
  return (VIEW_NAMES as readonly string[]).includes(value)
}

/** Validate the query string. Anything unexpected is a 400, never a guess. */
export function parseViewQuery(url: string): { view: ViewName; sessionId: string } | ViewError {
  let search: URLSearchParams
  try {
    search = new URL(url, 'http://localhost').searchParams
  } catch {
    return { ok: false, code: 'bad-view', message: 'unparsable request url' }
  }
  const view = search.get('view') ?? ''
  if (!isViewName(view)) {
    return { ok: false, code: 'bad-view', message: `unknown view "${view}"; expected one of ${VIEW_NAMES.join(', ')}` }
  }
  const sessionId = search.get('session') ?? ''
  if (sessionId.length === 0) {
    return { ok: false, code: 'bad-session', message: 'the session query parameter is required' }
  }
  return { view, sessionId }
}

/** Build the payload for one view from an engagement root (`<cwd>/.prism`). */
export async function payloadFor(view: ViewName, root: string): Promise<unknown> {
  const engine = new PrismEngine(root)
  switch (view) {
    case 'board':
      return await buildBoard(engine)
    case 'frontier':
      return (await buildBoard(engine)).frontier
    case 'graph':
      return await buildGraph(engine)
    case 'workers':
      return await buildWorkers(engine)
    case 'evidence':
      return await buildEvidence(engine)
    case 'report':
      return await buildReport(engine)
  }
}

/** Redact the serialized payload without breaking JSON (replacements carry no quotes). */
export function serializeView(response: ViewOk | ViewError): string {
  return redactSecrets(JSON.stringify(response))
}

/** Never create or write anything: the route only reads an existing `.prism/`. */
export function engagementRootOf(cwd: string): string | null {
  if (typeof cwd !== 'string' || cwd.length === 0 || !isAbsolute(cwd)) return null
  return join(cwd, '.prism')
}

/**
 * Resolve the working directory and agent preset of one session. No path ever
 * comes from the request, so the route cannot be turned into a file reader.
 */
export interface SessionFacts {
  cwd: string | null
  /** Committed agent preset id, or null when the session has not chosen one. */
  preset: string | null
  /** Which source the preset answer came from; purely diagnostic. */
  preset_source?: PresetSource
}

export type PresetSource = 'registry' | 'header' | 'persistence' | 'persisted-rows' | 'none'

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Last resort: the durable session row.
 *
 * `header.agentPreset` is the value captured when the session was created, and
 * the live projection is empty for a session this process has not activated. A
 * preset the user switched to afterwards is only visible in the stored row. The
 * read is best-effort: any structural change makes it return null rather than
 * throw, and the caller degrades to the older sources.
 */
function persistedRowsPreset(sessionId: string): string | null {
  if (!SESSION_ID_PATTERN.test(sessionId)) return null
  try {
    const home = process.env.DSH_HOME ?? process.env.DSH_HOME_DIR ?? join(homedir(), '.dsh')
    const file = join(home, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
    const doc = JSON.parse(readFileSync(file, 'utf8')) as any
    const row = doc?.record?.rows?.agentPreset
    const value = row !== null && typeof row === 'object' ? row.val : row
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

export type SessionResolver = (sessionId: string) => SessionFacts

/** The only preset whose sessions get the Prism surface (A2). */
export const PRISM_PRESET = 'prism'

export interface MinimalRequest {
  method?: string
  url?: string
}

export interface MinimalResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

/** Build the request handler. Pure apart from the injected resolver. */
export function createViewHandler(resolveFacts: SessionResolver, probe?: (sessionId: string) => Promise<unknown>) {
  return async function handle(request: MinimalRequest, response: MinimalResponse): Promise<void> {
    const send = (status: number, body: ViewOk | ViewError): void => {
      response.statusCode = status
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.setHeader('x-content-type-options', 'nosniff')
      response.end(serializeView(body))
    }

    const method = (request.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      send(405, { ok: false, code: 'bad-method', message: `method ${method} is not allowed` })
      return
    }

    const parsed = parseViewQuery(request.url ?? '')
    if ('ok' in parsed) {
      send(400, parsed)
      return
    }

    // Operator diagnostic: why did this session get (or not get) the panel?
    // Read-only, session-scoped, and it never returns file contents.
    if (probe !== undefined && /(?:^|[?&])probe=1(?:&|$)/.test(request.url ?? '')) {
      send(200, {
        ok: true,
        view: parsed.view,
        generated_at: new Date().toISOString(),
        payload: await probe(parsed.sessionId)
      })
      return
    }

    try {
      const facts = resolveFacts(parsed.sessionId)
      // A coding/standard/PPT session never sees Prism data, even when its
      // working directory happens to hold a `.prism/` from another engagement.
      if (facts.preset !== PRISM_PRESET) {
        send(200, {
          ok: true,
          view: parsed.view,
          generated_at: new Date().toISOString(),
          payload: { present: false, reason: 'not-a-prism-session', preset: facts.preset, preset_source: facts.preset_source }
        })
        return
      }
      const root = facts.cwd === null ? null : engagementRootOf(facts.cwd)
      if (root === null) {
        send(404, { ok: false, code: 'no-engagement', message: 'this session has no working directory' })
        return
      }
      const engine = new PrismEngine(root)
      if (!(await engine.exists())) {
        send(200, {
          ok: true,
          view: parsed.view,
          generated_at: new Date().toISOString(),
          payload: { present: false, reason: 'no-engagement-yet' }
        })
        return
      }
      send(200, {
        ok: true,
        view: parsed.view,
        generated_at: new Date().toISOString(),
        payload: await payloadFor(parsed.view, root)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      send(500, { ok: false, code: 'internal', message })
    }
  }
}

/**
 * Resolve a session's cwd and preset from the live session store, its immutable
 * header, or the persistence layer. Returns nulls when nothing can answer.
 */
export function createSessionResolver(ctx: any): SessionResolver {
  return (sessionId: string): SessionFacts => {
    const sessions = ctx?.get?.('sessions') ?? ctx?.sessions
    let session: any
    try {
      session = sessions?.get?.(sessionId)
    } catch {
      session = undefined
    }
    if (session === undefined || session === null) {
      const record = persistenceHeader(ctx, sessionId)
      const persisted = stringOrNull(record?.agentPreset)
      return {
        cwd: absoluteOrNull(record?.cwd),
        preset: persisted,
        preset_source: persisted === null ? 'none' : 'persistence'
      }
    }

    const { preset, source } = presetOf(ctx, session, sessionId)
    const headerCwd = absoluteOrNull(session?.header?.cwd)
    if (headerCwd !== null) return { cwd: headerCwd, preset, preset_source: source }

    const wd = ctx?.get?.('workingDirectory') ?? ctx?.workingDirectory
    if (wd !== undefined) {
      try {
        const dir = absoluteOrNull(wd.get(session))
        if (dir !== null) return { cwd: dir, preset, preset_source: source }
      } catch {
        // fall through to persistence
      }
    }
    return { cwd: absoluteOrNull(persistenceHeader(ctx, sessionId)?.cwd), preset, preset_source: source }
  }
}

function presetOf(ctx: any, session: any, sessionId: string): { preset: string | null; source: PresetSource } {
  const claims: { preset: string; source: PresetSource }[] = []
  const registry = ctx?.get?.('agentPresets') ?? ctx?.agentPresets
  try {
    const recorded = registry?.presetForSession?.(session)
    if (typeof recorded === 'string' && recorded.length > 0) claims.push({ preset: recorded, source: 'registry' })
  } catch {
    // a throwing registry is only one source of truth, not the end of the road
  }
  const header = stringOrNull(session?.header?.agentPreset)
  if (header !== null) claims.push({ preset: header, source: 'header' })
  const persisted = stringOrNull(persistenceHeader(ctx, sessionId)?.agentPreset)
  if (persisted !== null) claims.push({ preset: persisted, source: 'persistence' })
  const rowPreset = persistedRowsPreset(sessionId)
  if (rowPreset !== null) claims.push({ preset: rowPreset, source: 'persisted-rows' })
  if (claims.length === 0) return { preset: null, source: 'none' }
  // The live projection can lag behind a preset the user just switched to, while
  // the persisted row already records it. A `prism` claim is the narrower claim
  // and the surface it unlocks is read-only, so it wins over a lagging default.
  const prism = claims.find((claim) => claim.preset === PRISM_PRESET)
  if (prism !== undefined) return { preset: prism.preset, source: prism.source }
  return { preset: claims[0]!.preset, source: claims[0]!.source }
}

function persistenceHeader(ctx: any, sessionId: string): { cwd?: unknown; agentPreset?: unknown } | null {
  const persistence = ctx?.get?.('sessionPersistence') ?? ctx?.sessionPersistence
  try {
    const record = persistence?.stat?.(sessionId)
    if (record === undefined || record === null || typeof record.then === 'function') return null
    return record?.header ?? null
  } catch {
    return null
  }
}

function absoluteOrNull(value: unknown): string | null {
  return typeof value === 'string' && isAbsolute(value) ? value : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export const name = 'prism-web'
export const inject = ['webServer']

/** Compact JSON preview so a diagnostic can never return an unbounded body. */
function preview(value: unknown, limit = 1200): unknown {
  if (value === undefined) return undefined
  try {
    const text = JSON.stringify(value)
    if (text === undefined) return String(value)
    if (text.length <= limit) return JSON.parse(text) as unknown
    return { truncated: true, length: text.length, head: text.slice(0, limit) }
  } catch {
    return '[unserializable]'
  }
}

/**
 * Build the diagnostic used by `?probe=1`. It exists because a session's preset
 * has several possible sources (live projection, header, durable snapshot) and
 * they can disagree; guessing between them silently broke the panel once.
 */
function createProber(ctx: any) {
  return async (sessionId: string): Promise<unknown> => {
    const sessions = ctx?.get?.('sessions') ?? ctx?.sessions
    let session: any
    let sessionError: string | null = null
    try {
      session = sessions?.get?.(sessionId)
    } catch (error) {
      sessionError = (error as Error).message
    }
    const registry = ctx?.get?.('agentPresets') ?? ctx?.agentPresets
    let registryPreset: unknown = null
    let registryError: string | null = null
    try {
      registryPreset = registry?.presetForSession?.(session)
    } catch (error) {
      registryError = (error as Error).message
    }
    const persistence = ctx?.get?.('sessionPersistence') ?? ctx?.sessionPersistence
    let snapshot: unknown
    let snapshotError: string | null = null
    try {
      snapshot = await Promise.resolve(persistence?.stat?.(sessionId))
    } catch (error) {
      snapshotError = (error as Error).message
    }
    const snap = snapshot !== null && typeof snapshot === 'object' ? (snapshot as Record<string, unknown>) : null
    return {
      hasSession: session !== undefined && session !== null,
      sessionError,
      sessionKeys: session !== null && typeof session === 'object' ? Object.keys(session) : [],
      header: preview(session?.header),
      registryPreset,
      registryError,
      hasSnapshot: snap !== null,
      snapshotError,
      snapshotKeys: snap === null ? [] : Object.keys(snap),
      snapshotHeader: preview(snap?.header),
      snapshotBody: preview(snap === null ? undefined : { ...snap, header: undefined })
    }
  }
}

/** Register the read-only view route on the host web server. */
export function apply(ctx: any): void {
  const webServer = ctx?.webServer
  if (webServer === undefined || typeof webServer.register !== 'function') return
  const handle = createViewHandler(createSessionResolver(ctx), createProber(ctx))
  const route = { kind: 'exact', path: ROUTE_PATH, handler: handle }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => webServer.register(route), 'prism: read-only view routes')
    return
  }
  webServer.register(route)
}

export default { name, inject, apply }
