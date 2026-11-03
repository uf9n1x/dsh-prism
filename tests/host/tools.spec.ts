import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commanderTools, workerTools, nativeOps, RuntimeFactory, type AgentContext, type ToolDefinition } from '../../src/host/tools'
import { COMMANDER_TOOL_NAMES, WORKER_TOOL_NAMES, isExecutionTool } from '../../src/orchestrator/catalog'

let dir: string
let registered: ToolDefinition[]
let denials: string[]

function stubContext(approval?: { request: (input: any) => Promise<any> }) {
  registered = []
  denials = []
  const ctx: AgentContext = {
    get: (name: string) => (name === 'approval' ? approval : undefined),
    tools: {
      register(definition: ToolDefinition) {
        registered.push(definition)
        return () => undefined
      },
      guard(guard: (exec: any) => string | undefined) {
        denials.push(String(guard({ toolName: 'bash' })))
        denials.push(String(guard({ toolName: 'mcp__kali__run' })))
        denials.push(String(guard({ toolName: 'prism_board' })))
        return () => undefined
      }
    }
  }
  return ctx
}

const execStub = (cwd: string) => ({ agent: { session: { id: 'sess-cmd' }, cwd }, cwd })

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prism-tools-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('P2 tool surface', () => {
  it('the commander registers exactly the catalog control tools and nothing executable', () => {
    const ctx = stubContext()
    const tools = commanderTools(ctx, new RuntimeFactory(ctx))
    expect(tools.map((t) => t.name)).toEqual([...COMMANDER_TOOL_NAMES])
    for (const t of tools) expect(isExecutionTool(t.name)).toBe(false)
  })

  it('the worker registers exactly the catalog worker tools and no control tool', () => {
    const ctx = stubContext()
    const tools = workerTools(ctx, new RuntimeFactory(ctx))
    expect(tools.map((t) => t.name)).toEqual([...WORKER_TOOL_NAMES])
    for (const t of tools) expect(COMMANDER_TOOL_NAMES as readonly string[]).not.toContain(t.name)
  })

  it('every tool declares a JSON-schema input and string output', () => {
    const ctx = stubContext()
    for (const t of [...commanderTools(ctx, new RuntimeFactory(ctx)), ...workerTools(ctx, new RuntimeFactory(ctx))]) {
      expect(t.parameters).toMatchObject({ type: 'object' })
      expect(t.output.schema).toEqual({ type: 'string' })
      expect(typeof t.execute).toBe('function')
    }
  })

  it('prism_init refuses to mint a mandate without a host approval channel', async () => {
    const ctx = stubContext()
    const factory = new RuntimeFactory(ctx, {})
    const init = commanderTools(ctx, factory).find((t) => t.name === 'prism_init')!
    await expect(
      init.execute(
        { origin: 'acme', goal: 'g', authorization: 'SOE-1', targets: ['10.0.0.5'], actions: ['scan'] },
        execStub(dir)
      )
    ).rejects.toThrow(/host approval/i)
  })

  it('prism_init proceeds when the host approves and creates a mandate, then refuses a second init', async () => {
    const ctx = stubContext({ request: async () => 'allowed-once' })
    const factory = new RuntimeFactory(ctx, {})
    const init = commanderTools(ctx, factory).find((t) => t.name === 'prism_init')!
    const args = { origin: 'acme', goal: 'g', authorization: 'SOE-1', targets: ['10.0.0.5'], actions: ['scan'] }
    const first = JSON.parse(await init.execute(args, execStub(dir)))
    expect(first.ok).toBe(true)
    expect(first.mandate).toBe('md001')
    await expect(init.execute(args, execStub(dir))).rejects.toThrow(/already exists/i)
  })

  it('prism_tighten rejects widening even with host approval', async () => {
    const ctx = stubContext({ request: async () => 'allowed-once' })
    const factory = new RuntimeFactory(ctx, {})
    const tools = commanderTools(ctx, factory)
    const init = tools.find((t) => t.name === 'prism_init')!
    await init.execute(
      { origin: 'acme', goal: 'g', authorization: 'SOE-1', targets: ['10.0.0.5'], actions: ['scan'] },
      execStub(dir)
    )
    const tighten = tools.find((t) => t.name === 'prism_tighten')!
    await expect(
      tighten.execute({ mandate_id: 'md001', targets: ['10.0.0.0/8'], actions: ['scan', 'exploit'] }, execStub(dir))
    ).rejects.toThrow(/only narrow/i)
  })

  it('a worker tool without a bound assignment refuses to execute anything', async () => {
    const ctx = stubContext()
    const factory = new RuntimeFactory(ctx, {})
    const rt = factory.forRoot(join(dir, '.prism'), dir)
    await rt.init('acme', 'g')
    const run = workerTools(ctx, factory).find((t) => t.name === 'prism_run')!
    await expect(run.execute({ command: 'echo hi' }, execStub(dir))).rejects.toThrow(/no live Prism assignment/i)
  })
})

describe('host approval contract (regression: the first real run failed here)', () => {
  const initArgs = { origin: 'lab', goal: 'g', authorization: 'SOE-1', targets: ['10.0.0.5'], actions: ['scan'] }
  const callInit = async (approval: { request: (input: any) => Promise<any> } | undefined) => {
    const ctx = stubContext(approval)
    const factory = new RuntimeFactory(ctx, {})
    const init = commanderTools(ctx, factory).find((t) => t.name === 'prism_init')!
    try {
      const out = await init.execute(initArgs, execStub(dir))
      return { ok: true as const, out }
    } catch (err) {
      return { ok: false as const, error: (err as Error).message }
    }
  }

  it('sends the request shape the host documents: agent, toolName, reason, displayReason', async () => {
    const seen: any[] = []
    const result = await callInit({
      request: async (input) => {
        seen.push(input)
        return 'allowed-once'
      }
    })
    expect(result.ok).toBe(true)
    expect(seen).toHaveLength(1)
    const req = seen[0]
    expect(req.agent).toMatchObject({ session: { id: 'sess-cmd' } })
    expect(req.toolName).toBe('prism_init')
    expect(typeof req.reason).toBe('string')
    expect(req.reason).toContain('create engagement')
    expect(req.displayReason).toMatchObject({ en: expect.any(String) })
    // The fields the previous adapter invented must never be sent again: the
    // service ignores them and then dereferences the missing agent.
    expect(req).not.toHaveProperty('subject')
    expect(req).not.toHaveProperty('justification')
    expect(req).not.toHaveProperty('requestedMode')
  })

  it('grants only on the single positive outcome', async () => {
    for (const outcome of ['rejected', 'cancelled', 'unavailable'] as const) {
      const result = await callInit({ request: async () => outcome })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain(outcome)
    }
  })

  it('turns a throwing approval service into a denial instead of a crash', async () => {
    const result = await callInit({
      request: async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'session')")
      }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/host approval/i)
  })

  it('refuses without asking when the call carries no agent', async () => {
    let asked = 0
    const ctx = stubContext({ request: async () => { asked += 1; return 'allowed-once' } })
    const init = commanderTools(ctx, new RuntimeFactory(ctx, {})).find((t) => t.name === 'prism_init')!
    await expect(init.execute(initArgs, { cwd: dir })).rejects.toThrow(/no calling agent/i)
    expect(asked).toBe(0)
  })

  it('opens the mandate for the backends the caller names, and only those', async () => {
    const ctx = stubContext({ request: async () => 'allowed-once' })
    const init = commanderTools(ctx, new RuntimeFactory(ctx, {})).find((t) => t.name === 'prism_init')!
    const out = JSON.parse(await init.execute({ ...initArgs, backends: ['local', 'kali'] }, execStub(dir)))
    expect(out.ok).toBe(true)
    const mandate = JSON.parse(await readFile(join(dir, '.prism', 'mandates', `${String(out.mandate)}.json`), 'utf8')) as {
      scope: { backends: string[] }
    }
    expect(mandate.scope.backends).toEqual(['local', 'kali'])
  })

  it('defaults the mandate to the local backend when the caller names none', async () => {
    const ctx = stubContext({ request: async () => 'allowed-once' })
    const init = commanderTools(ctx, new RuntimeFactory(ctx, {})).find((t) => t.name === 'prism_init')!
    const out = JSON.parse(await init.execute(initArgs, execStub(dir)))
    const mandate = JSON.parse(await readFile(join(dir, '.prism', 'mandates', `${String(out.mandate)}.json`), 'utf8')) as {
      scope: { backends: string[] }
    }
    expect(mandate.scope.backends).toEqual(['local'])
  })
})

describe('native subagent ops use the host contract (regression: spawn threw immediately)', () => {
  const withSubagents = (subagents: any): AgentContext => ({
    get: (name: string) => (name === 'subagents' ? subagents : undefined),
    tools: { register: () => () => undefined, guard: () => () => undefined }
  })

  it('passes a real AbortSignal to startActivation, which dereferences it', async () => {
    const seen: any[] = []
    const ctx = withSubagents({
      startActivation: async (spec: any) => {
        // Mirrors the host: it calls throwIfAborted() before doing any work.
        spec.signal.throwIfAborted()
        seen.push(spec)
        return { childId: 'child-1' }
      }
    })
    const ops = nativeOps(ctx, execStub(dir))
    const out = await ops.spawn({ preset: 'prism-worker', prompt: 'p', label: 'l', cwd: dir })
    expect(out.sessionId).toBe('child-1')
    expect(seen[0]).toMatchObject({ provider: 'spawn', delivery: 'parent' })
    expect(seen[0].request.agentPreset).toBe('prism-worker')
    expect(seen[0].signal).toBeInstanceOf(AbortSignal)
  })

  it('prefers the tool call signal so a cancelled turn propagates', async () => {
    const controller = new AbortController()
    let received: AbortSignal | undefined
    const ctx = withSubagents({
      startActivation: async (spec: any) => {
        received = spec.signal
        return { childId: 'child-2' }
      }
    })
    const ops = nativeOps(ctx, { ...execStub(dir), signal: controller.signal })
    await ops.spawn({ preset: 'prism-worker', prompt: 'p', label: 'l', cwd: dir })
    expect(received).toBe(controller.signal)
  })

  it('refuses to report success when the host returns no child id', async () => {
    const ctx = withSubagents({ startActivation: async () => ({}) })
    await expect(nativeOps(ctx, execStub(dir)).spawn({ preset: 'w', prompt: 'p', label: 'l', cwd: dir })).rejects.toThrow(
      /no child session id/i
    )
  })

  it('sends with the required options object and interrupts with an authority kind', async () => {
    const calls: any[] = []
    const ctx = withSubagents({
      startActivation: async () => ({ childId: 'c' }),
      sendMessage: async (...args: any[]) => {
        args[3].signal.throwIfAborted()
        calls.push(args)
        return 'm1'
      },
      interrupt: (id: string, authority: any) => {
        calls.push([id, authority])
      }
    })
    const ops = nativeOps(ctx, execStub(dir))
    await ops.send('child-1', 'hello')
    await ops.interrupt('child-1')
    expect(calls[0][3].signal).toBeInstanceOf(AbortSignal)
    expect(calls[1][1]).toMatchObject({ kind: 'ancestor' })
  })
})
