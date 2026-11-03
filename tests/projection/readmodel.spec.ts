import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismRuntime, rootFor, type NativeOps } from '../../src/host/runtime'
import { buildGraph } from '../../src/projection/readmodel'

let dir: string
let runtime: PrismRuntime

const ops: NativeOps = {
  spawn: async () => ({ sessionId: 'sess-graph-worker' }),
  send: async () => undefined,
  interrupt: async () => undefined
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prism-graph-'))
  runtime = new PrismRuntime({ root: rootFor(dir), cwd: dir })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 })
})

/** Seed an engagement with one assignment, one evidence node and a progress report. */
async function seed(): Promise<void> {
  await runtime.init('acme', 'solve the box', 'SOE-7')
  const mandate = await runtime.engine.createMandate({
    policy_version: 'v1',
    scope: { targets: ['10.0.0.9'], actions: ['scan', 'read'], backends: ['local'] },
    strength: 'read',
    source: 'user',
    basis: 'SOE-7'
  })
  await runtime.reason([{ description: 'enumerate the target' }])
  const board = await runtime.board()
  const intentId = board.frontier.available[0]!.id
  await runtime.dispatch({ intent_id: intentId, mandate_id: mandate.id, brief: 'enumerate the target' }, ops)
  const assignment = (await runtime.engine.listAssignments())[0]!
  const evidence = await runtime.engine.addEvidence({
    title: 'nmap output',
    summary: 'open ports 22/80',
    path: 'evidence/e001.txt',
    bytes: 42
  })
  await runtime.engine.store.addFact({
    title: 'host is up',
    summary: 'icmp echo reply observed',
    creator: assignment.worker_session ?? assignment.id,
    source_intent: intentId,
    evidence: [evidence.id]
  })
  await runtime.engine.addReport({
    assignment_id: assignment.id,
    kind: 'progress',
    text: 'halfway through enumeration',
    facts: []
  })
}

describe('graph view stays a clean DAG and reports live activity (BUG-002/004)', () => {
  it('surfaces reports/executions/evidence as activity counts, not as clutter nodes', async () => {
    await seed()
    const graph = await buildGraph(runtime.engine)
    expect(graph.activity.reports).toBeGreaterThan(0)
    expect(graph.activity.evidence).toBeGreaterThan(0)
    // The DAG only holds the three reasoning kinds; reports are shown as counts.
    for (const node of graph.nodes) expect(['fact', 'intent', 'assignment']).toContain(node.kind)
    expect(Object.keys(graph.counts).sort()).toEqual(['assignment', 'fact', 'intent'])
  })

  it('labels each worker node by its own assignment id, not the shared intent id (BUG-004)', async () => {
    await seed()
    const graph = await buildGraph(runtime.engine)
    const workers = graph.nodes.filter((n) => n.kind === 'assignment')
    expect(workers.length).toBeGreaterThan(0)
    for (const worker of workers) expect(worker.label).toMatch(/^a\d{3,}$/)
  })

  it('keeps the original fact/intent/assignment nodes and counts', async () => {
    await seed()
    const graph = await buildGraph(runtime.engine)
    expect(graph.counts.fact).toBeGreaterThan(0)
    expect(graph.counts.intent).toBeGreaterThan(0)
    expect(graph.counts.assignment).toBeGreaterThan(0)
    expect(graph.edges.some((e) => e.kind === 'claim')).toBe(true)
  })
})
