import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismEngine } from '../../src/engine/engine'
import { OutboxRunner } from '../../src/runtime/outbox'
import { EventRuntime } from '../../src/runtime/fastpath'
import { reconcile, describeRecovery } from '../../src/runtime/recover'
import { Watchdog, isWatchdogOp, WATCHDOG_OPS } from '../../src/runtime/watchdog'

let dir: string
let engine: PrismEngine

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prism-rt-'))
  engine = new PrismEngine(join(dir, '.prism'))
  await engine.init('acme', 'g')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function assignmentWithMandate() {
  const intent = await engine.store.addIntent({ description: 'probe' })
  const mandate = await engine.createMandate({
    policy_version: 'v1',
    scope: { targets: ['10.0.0.5'], actions: ['scan', 'run'], backends: ['local'] },
    strength: 'read',
    source: 'user',
    basis: 'SOE'
  })
  return engine.createAssignment({ intent_id: intent.id, mandate_id: mandate.id, backend: 'local' })
}

describe('P5 outbox semantics', () => {
  it('executes a pending effect once and records it done', async () => {
    const runner = new OutboxRunner(engine)
    let calls = 0
    runner.register('http', async () => {
      calls += 1
      return { ok: true }
    })
    const fx = await engine.enqueueEffect({ kind: 'http', payload: { url: 'x' } })
    const report = await runner.drain()
    expect(report.done).toEqual([fx.id])
    expect(calls).toBe(1)
    await runner.drain()
    expect(calls).toBe(1)
    expect((await engine.getEffect(fx.id)).status).toBe('done')
  })

  it('quarantines a non-idempotent effect whose executor throws, and never retries it automatically', async () => {
    const runner = new OutboxRunner(engine)
    runner.register('http', async () => {
      throw new Error('timeout after dispatch')
    })
    const fx = await engine.enqueueEffect({ kind: 'http', payload: {} })
    const report = await runner.drain()
    expect(report.unknown).toEqual([fx.id])
    const second = await runner.drain()
    expect(second.attempted).toEqual([])
    expect((await engine.getEffect(fx.id)).status).toBe('unknown')
  })

  it('retries an idempotent effect as failed rather than unknown', async () => {
    const runner = new OutboxRunner(engine)
    runner.register('note', async () => {
      throw new Error('disk full')
    })
    const fx = await engine.enqueueEffect({ kind: 'note', payload: {}, idempotent: true })
    const report = await runner.drain()
    expect(report.failed).toEqual([fx.id])
  })

  it('marks an effect unknown when no executor is registered', async () => {
    const runner = new OutboxRunner(engine)
    const fx = await engine.enqueueEffect({ kind: 'unregistered', payload: {} })
    const report = await runner.drain()
    expect(report.unknown).toEqual([fx.id])
  })
})

describe('P5 event fast path', () => {
  it('persists a duplicate event but never routes it twice', async () => {
    const events = new EventRuntime(engine)
    const first = await events.accept({ source: 'subagent/end', dedupeKey: 's1:completed' })
    expect(first.kind).toBe('wake')
    const again = await events.accept({ source: 'subagent/end', dedupeKey: 's1:completed' })
    expect(again.kind).toBe('duplicate')
    expect(await engine.listEvents()).toHaveLength(1)
  })

  it('filters an event raised by the commander itself', async () => {
    const events = new EventRuntime(engine)
    const decision = await events.accept({
      source: 'session/event',
      dedupeKey: 'self-1',
      ownerSession: 'sess-cmd',
      commanderSession: 'sess-cmd',
      body: 'hello'
    })
    expect(decision.kind).toBe('filtered')
    const [record] = await engine.listEvents()
    expect(record?.status).toBe('filtered')
    expect(record?.filter_reason).toMatch(/own-session/)
  })

  it('routes an event bound to a live assignment instead of waking the commander', async () => {
    const events = new EventRuntime(engine)
    const assignment = await assignmentWithMandate()
    const decision = await events.accept({
      source: 'worker/progress',
      dedupeKey: 'progress-1',
      intentId: assignment.intent_id,
      body: 'halfway'
    })
    expect(decision.kind).toBe('route-assignment')
    if (decision.kind === 'route-assignment') expect(decision.assignmentId).toBe(assignment.id)
  })

  it('coalesces a burst of distinct events inside the cooling window', async () => {
    const events = new EventRuntime(engine, { cooldownMs: 10_000 })
    const t = Date.now()
    const a = await events.accept({ source: 'x', dedupeKey: 'a', body: 'a', now: t })
    const b = await events.accept({ source: 'x', dedupeKey: 'b', body: 'b', now: t + 10 })
    expect(a.kind).toBe('wake')
    expect(b.kind).toBe('coalesced')
  })

  it('filters an empty event body with a recorded reason', async () => {
    const events = new EventRuntime(engine)
    const decision = await events.accept({ source: 'x', dedupeKey: 'empty', body: '   ' })
    expect(decision.kind).toBe('filtered')
    expect((await engine.listEvents())[0]?.filter_reason).toMatch(/empty/i)
  })
})

describe('P5 recovery', () => {
  it('marks live assignments interrupted and lists them as resumable', async () => {
    const assignment = await assignmentWithMandate()
    await engine.setAssignmentStatus(assignment.id, 'running')
    const report = await reconcile(engine)
    expect(report.interrupted).toContain(assignment.id)
    expect(report.resumable.map((r) => r.assignment_id)).toContain(assignment.id)
    expect((await engine.getAssignment(assignment.id)).status).toBe('interrupted')
    expect(describeRecovery(report)).toContain('schema v1')
  })

  it('surfaces unknown effects for review instead of dispatching them', async () => {
    const fx = await engine.enqueueEffect({ kind: 'http', payload: {} })
    await engine.markEffectUnknown(fx.id)
    const report = await reconcile(engine)
    expect(report.unknown_effects.map((e) => e.id)).toContain(fx.id)
    expect(report.review_required).toBe(true)
    expect(report.pending_effects).toEqual([])
  })

  it('keeps queueing pending effects for the outbox after restart', async () => {
    const fx = await engine.enqueueEffect({ kind: 'http', payload: {} })
    const report = await reconcile(engine)
    expect(report.pending_effects).toContain(fx.id)
  })
})

describe('P5 restricted watchdog', () => {
  it('exposes exactly four operations and no authority-changing one', () => {
    expect([...WATCHDOG_OPS]).toEqual(['pause', 'interrupt', 'request-human', 'write-watchdog-report'])
    expect(isWatchdogOp('pause')).toBe(true)
    expect(isWatchdogOp('widen-mandate')).toBe(false)
    expect(isWatchdogOp('edit-prompt')).toBe(false)
  })

  it('pauses a stalled assignment and can interrupt its child', async () => {
    const assignment = await assignmentWithMandate()
    await engine.setAssignmentStatus(assignment.id, 'running')
    const dog = new Watchdog(engine, { stallMs: 0, maxActive: 10 })
    const findings = await dog.scan()
    expect(findings.some((f) => f.assignment_id === assignment.id)).toBe(true)
    const interrupted: string[] = []
    const report = await dog.act(findings, async (id) => {
      interrupted.push(id)
      return true
    })
    expect(interrupted).toContain(assignment.id)
    expect((await engine.getAssignment(assignment.id)).status).toBe('paused')
    expect(report.actions.every((a) => isWatchdogOp(a.op))).toBe(true)
  })

  it('raises a human request for an unknown effect instead of resolving it', async () => {
    const fx = await engine.enqueueEffect({ kind: 'http', payload: {} })
    await engine.markEffectUnknown(fx.id)
    const dog = new Watchdog(engine, { stallMs: 60_000, maxActive: 10 })
    const findings = await dog.scan()
    const report = await dog.act(findings, async () => false)
    expect(report.actions.some((a) => a.op === 'request-human')).toBe(true)
    expect((await engine.getEffect(fx.id)).status).toBe('unknown')
  })
})
