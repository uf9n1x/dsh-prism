import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commanderTools, workerTools, RuntimeFactory, type AgentContext, type ToolDefinition } from '../../src/host/tools'
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
    const ctx = stubContext({ request: async () => ({ approved: true }) })
    const factory = new RuntimeFactory(ctx, {})
    const init = commanderTools(ctx, factory).find((t) => t.name === 'prism_init')!
    const args = { origin: 'acme', goal: 'g', authorization: 'SOE-1', targets: ['10.0.0.5'], actions: ['scan'] }
    const first = JSON.parse(await init.execute(args, execStub(dir)))
    expect(first.ok).toBe(true)
    expect(first.mandate).toBe('md001')
    await expect(init.execute(args, execStub(dir))).rejects.toThrow(/already exists/i)
  })

  it('prism_tighten rejects widening even with host approval', async () => {
    const ctx = stubContext({ request: async () => ({ approved: true }) })
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
