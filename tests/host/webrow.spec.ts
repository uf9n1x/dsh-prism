import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismRuntime, rootFor, type NativeOps } from '../../src/host/runtime'
import {
  ROUTE_PATH,
  VIEW_NAMES,
  apply,
  createSessionResolver,
  createViewHandler,
  engagementRootOf,
  parseViewQuery,
  payloadFor,
  serializeView
} from '../../src/host/webrow'

let dir: string
let runtime: PrismRuntime

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prism-web-'))
  runtime = new PrismRuntime({ root: rootFor(dir), cwd: dir })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 })
})

interface Captured {
  status: number
  headers: Record<string, string>
  body: string
}

async function call(handler: (req: any, res: any) => Promise<void>, url: string, method = 'GET'): Promise<Captured> {
  const headers: Record<string, string> = {}
  const captured: Captured = { status: 0, headers, body: '' }
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value
    },
    end(body?: string) {
      captured.status = this.statusCode
      captured.body = body ?? ''
    }
  }
  await handler({ method, url }, response)
  if (captured.status === 0) captured.status = response.statusCode
  return captured
}

const json = (captured: Captured) => JSON.parse(captured.body) as any

const ops: NativeOps = {
  spawn: async () => ({ sessionId: 'sess-worker-web' }),
  send: async () => undefined,
  interrupt: async () => undefined
}

/** Populate a real engagement so every view has something to project. */
async function seed(): Promise<void> {
  await runtime.init('acme', 'find the auth bypass', 'SOE-42')
  const mandate = await runtime.engine.createMandate({
    policy_version: 'v1',
    scope: { targets: ['10.0.0.5'], actions: ['scan', 'read'], backends: ['local'] },
    strength: 'read',
    source: 'user',
    basis: 'SOE-42'
  })
  await runtime.reason([{ description: 'enumerate the login surface' }])
  const board = await runtime.board()
  const intentId = board.frontier.available[0]!.id
  await runtime.dispatch(
    { intent_id: intentId, mandate_id: mandate.id, brief: 'enumerate the login surface' },
    ops
  )
}

const resolver = () => (sessionId: string) => ({ cwd: dir, preset: sessionId === 'worker-session' ? 'prism-worker' : 'prism' })

describe('P8 read-only view route', () => {
  it('serves every view name from a real engagement', async () => {
    await seed()
    const handler = createViewHandler(resolver())
    for (const view of VIEW_NAMES) {
      const response = await call(handler, `${ROUTE_PATH}?view=${view}&session=session-1`)
      expect(response.status, view).toBe(200)
      const body = json(response)
      expect(body.ok, view).toBe(true)
      expect(body.view).toBe(view)
      expect(body.payload, view).toBeTruthy()
    }
  })

  it('projects the graph with facts, intents and claiming assignments', async () => {
    await seed()
    const handler = createViewHandler(resolver())
    const body = json(await call(handler, `${ROUTE_PATH}?view=graph&session=session-1`))
    const kinds = body.payload.nodes.map((n: { kind: string }) => n.kind)
    expect(kinds).toContain('fact')
    expect(kinds).toContain('intent')
    expect(kinds).toContain('assignment')
    expect(body.payload.edges.some((e: { kind: string }) => e.kind === 'claim')).toBe(true)
    expect(body.payload.counts.intent).toBeGreaterThan(0)
  })

  it('returns present:false instead of failing when the session has no engagement', async () => {
    const handler = createViewHandler(() => ({ cwd: null, preset: 'prism' }))
    const response = await call(handler, `${ROUTE_PATH}?view=board&session=session-1`)
    expect(response.status).toBe(404)
    expect(json(response).code).toBe('no-engagement')
  })

  it('returns an empty projection when the working directory has no .prism yet', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'prism-web-empty-'))
    try {
      const handler = createViewHandler(() => ({ cwd: empty, preset: 'prism' }))
      const body = json(await call(handler, `${ROUTE_PATH}?view=board&session=session-1`))
      expect(body.ok).toBe(true)
      expect(body.payload.present).toBe(false)
    } finally {
      await rm(empty, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 })
    }
  })

  it('rejects an unknown view name and a missing session with 400', async () => {
    const handler = createViewHandler(resolver())
    const badView = await call(handler, `${ROUTE_PATH}?view=secrets&session=session-1`)
    expect(badView.status).toBe(400)
    expect(json(badView).code).toBe('bad-view')

    const noSession = await call(handler, `${ROUTE_PATH}?view=board`)
    expect(noSession.status).toBe(400)
    expect(json(noSession).code).toBe('bad-session')
  })

  it('rejects any method that could mutate state', async () => {
    const handler = createViewHandler(resolver())
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await call(handler, `${ROUTE_PATH}?view=board&session=session-1`, method)
      expect(response.status, method).toBe(405)
      expect(json(response).code).toBe('bad-method')
    }
  })

  it('never accepts a path from the client: only the session resolves the root', async () => {
    await seed()
    expect(engagementRootOf('C:\\work\\acme')).toBe(join('C:\\work\\acme', '.prism'))
    // A relative or empty cwd cannot become an engagement root.
    expect(engagementRootOf('')).toBeNull()
    expect(engagementRootOf('relative/dir')).toBeNull()
    // A traversal attempt in the query is not a parameter the route reads.
    const parsed = parseViewQuery(`${ROUTE_PATH}?view=board&session=../../etc`)
    expect('ok' in parsed).toBe(false)
    expect((parsed as { view: string }).view).toBe('board')
    const handler = createViewHandler(resolver())
    const response = await call(handler, `${ROUTE_PATH}?view=board&session=session-1&cwd=/etc`)
    expect(response.status).toBe(200)
    const body = json(response)
    expect(body.payload.present).toBe(true)
  })

  it('redacts credential-shaped text before it reaches the browser', async () => {
    const leaked = {
      ok: true as const,
      view: 'report' as const,
      generated_at: '2026-11-03T00:00:00.000Z',
      payload: { note: 'api_key=AKIA-not-real-but-shaped', other: 'Bearer abcdefghijklmnop' }
    }
    const body = serializeView(leaked)
    expect(body).not.toContain('AKIA-not-real-but-shaped')
    expect(body).not.toContain('abcdefghijklmnop')
    expect(() => JSON.parse(body)).not.toThrow()
  })

  it('declares no-store and nosniff on every response', async () => {
    await seed()
    const handler = createViewHandler(resolver())
    const response = await call(handler, `${ROUTE_PATH}?view=board&session=session-1`)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['content-type']).toContain('application/json')
  })
})

describe('P8 view route wiring', () => {
  it('registers exactly one exact route and disposes it', () => {
    const registered: { kind: string; path: string }[] = []
    const disposed: string[] = []
    const ctx = {
      webServer: {
        register(route: { kind: string; path: string }) {
          registered.push({ kind: route.kind, path: route.path })
          return () => disposed.push(route.path)
        }
      },
      effect(fn: () => () => void) {
        fn()
      },
      get: () => undefined
    }
    apply(ctx)
    expect(registered).toEqual([{ kind: 'exact', path: ROUTE_PATH }])
    expect(ROUTE_PATH).toBe('/prism/view')
  })

  it('stays inert when the profile has no webServer', () => {
    expect(() => apply({ effect: () => undefined, get: () => undefined })).not.toThrow()
  })

  it('resolves a session cwd and preset from the live session header', () => {
    const session = { header: { cwd: 'C:\\work\\acme', agentPreset: 'prism' } }
    const ctx = {
      get(name: string) {
        if (name === 'sessions') return { get: (id: string) => (id === 's1' ? session : undefined) }
        if (name === 'agentPresets') return { presetForSession: () => 'prism' }
        if (name === 'workingDirectory') throw new Error('should not be reached')
        return undefined
      }
    }
    expect(createSessionResolver(ctx)('s1')).toEqual({ cwd: 'C:\\work\\acme', preset: 'prism', preset_source: 'registry' })
  })

  it('falls back to workingDirectory, and to the header preset, when no registry answers', () => {
    const session = { header: { agentPreset: 'standard' } }
    const ctx = {
      get(name: string) {
        if (name === 'sessions') return { get: () => session }
        if (name === 'workingDirectory') return { get: () => '/srv/acme' }
        return undefined
      }
    }
    expect(createSessionResolver(ctx)('s1')).toEqual({ cwd: '/srv/acme', preset: 'standard', preset_source: 'header' })
  })

  it('returns nulls for an unknown session instead of guessing a directory', () => {
    const ctx = { get: () => undefined }
    expect(createSessionResolver(ctx)('nope')).toEqual({ cwd: null, preset: null, preset_source: 'none' })
  })

  it('believes a persisted prism selection even when the live projection still says standard', () => {
    // Observed on a real host: the user switches to the Prism preset, the row is
    // written to disk, but presetForSession() keeps reporting the previous
    // default until the projection catches up. Trusting only the registry left a
    // real Prism session with no panel at all.
    const session = { header: { cwd: '/srv/acme' } }
    const ctx = {
      get(name: string) {
        if (name === 'sessions') return { get: () => session }
        if (name === 'agentPresets') return { presetForSession: () => 'standard' }
        if (name === 'sessionPersistence') return { stat: () => ({ header: { cwd: '/srv/acme', agentPreset: 'prism' } }) }
        return undefined
      }
    }
    expect(createSessionResolver(ctx)('s1')).toEqual({ cwd: '/srv/acme', preset: 'prism', preset_source: 'persistence' })
  })

  it('keeps a genuine standard session standard when every source agrees', () => {
    const session = { header: { cwd: '/srv/code', agentPreset: 'standard' } }
    const ctx = {
      get(name: string) {
        if (name === 'sessions') return { get: () => session }
        if (name === 'agentPresets') return { presetForSession: () => 'standard' }
        if (name === 'sessionPersistence') return { stat: () => ({ header: { agentPreset: 'standard' } }) }
        return undefined
      }
    }
    expect(createSessionResolver(ctx)('s1')).toMatchObject({ preset: 'standard', preset_source: 'registry' })
  })

  it('gives a non-Prism session no data even when the directory holds a .prism', async () => {
    await seed()
    const handler = createViewHandler(() => ({ cwd: dir, preset: 'standard' }))
    const body = json(await call(handler, `${ROUTE_PATH}?view=board&session=session-1`))
    expect(body.ok).toBe(true)
    expect(body.payload.present).toBe(false)
    expect(body.payload.reason).toBe('not-a-prism-session')
    expect(body.payload.preset).toBe('standard')
  })

  it('gives a prism-worker session no panel either: only the commander has one', async () => {
    await seed()
    const handler = createViewHandler(() => ({ cwd: dir, preset: 'prism-worker' }))
    const body = json(await call(handler, `${ROUTE_PATH}?view=graph&session=worker-session`))
    expect(body.payload.present).toBe(false)
  })

  it('reads the same projections the commander reads', async () => {
    await seed()
    const root = rootFor(dir)
    const board = await payloadFor('board', root)
    expect((board as { present: boolean }).present).toBe(true)
    const frontier = (await payloadFor('frontier', root)) as { available: unknown[] }
    expect(frontier).toBeTruthy()
    const report = (await payloadFor('report', root)) as { intents: { open: number }; assignments: Record<string, number> }
    expect(report.intents.open).toBeGreaterThan(0)
    expect(Object.keys(report.assignments).length).toBeGreaterThan(0)
  })
})
