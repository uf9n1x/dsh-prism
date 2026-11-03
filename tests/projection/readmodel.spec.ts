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
  await runtime.engine.store.writeEntity('evidence', 'e001', {
    id: 'e001',
    title: 'nmap output',
    summary: 'open ports 22/80',
    path: 'evidence/e001.txt',
    bytes: 42,
    created_at: new Date().toISOString()
  })
  await runtime.engine.store.addFact({
    title: 'host is up',
    summary: 'icmp echo reply observed',
    creator: assignment.worker_session ?? assignment.id,
    source_intent: intentId,
    evidence: ['e001']
  })
  await runtime.engine.addReport({
    assignment_id: assignment.id,
    kind: 'progress',
    text: 'halfway through enumeration',
    facts: []
  })
}

describe('graph view includes live progress (BUG-002)', () => {
  it('projects report and evidence nodes and their edges', async () => {
    await seed()
    const graph = await buildGraph(runtime.engine)
    const kinds = graph.nodes.map((n) => n.kind)
    expect(kinds).toContain('report')
    expect(kinds).toContain('evidence')
    expect(graph.counts.report).toBeGreaterThan(0)
    expect(graph.counts.evidence).toBeGreaterThan(0)
    expect(graph.edges.some((e) => e.kind === 'report')).toBe(true)
    expect(graph.edges.some((e) => e.kind === 'evidence')).toBe(true)
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
