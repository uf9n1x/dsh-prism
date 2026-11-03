import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismEngine } from '../../src/engine/engine'

let dir: string
let engine: PrismEngine
let root: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prism-engine-'))
  root = join(dir, '.prism')
  engine = new PrismEngine(root)
  await engine.init('acme', 'find auth bypass')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function seedIntentAndMandate(actions = ['scan', 'read']) {
  const intent = await engine.store.addIntent({ description: 'probe 10.0.0.5' })
  const mandate = await engine.createMandate({
    policy_version: 'v1',
    scope: { targets: ['10.0.0.5'], actions, backends: ['local'] },
    strength: 'read',
    source: 'user',
    basis: 'SOE'
  })
  return { intent, mandate }
}

describe('PrismEngine: domain writers + integrity', () => {
  it('creates a mandate, assignment, report and reads them back', async () => {
    const { intent, mandate } = await seedIntentAndMandate()
    const a = await engine.createAssignment({ intent_id: intent.id, mandate_id: mandate.id, backend: 'local' })
    expect(a.id).toBe('a001')
    expect(a.status).toBe('spawned')
    const r = await engine.addReport({ assignment_id: a.id, kind: 'progress', text: 'started', facts: [] })
    expect(r.id).toBe('r001')
    expect((await engine.listReports()).length).toBe(1)
  })

  it('rejects a report or assignment that references a missing entity', async () => {
    await expect(engine.addReport({ assignment_id: 'a999', kind: 'progress', text: 'x' })).rejects.toThrow(/assignment/i)
    await expect(
      engine.createAssignment({ intent_id: 'i999', mandate_id: 'md999', backend: 'local' })
    ).rejects.toThrow(/intent|mandate/i)
  })

  it('deduplicates events by dedupe_key: a repeat does not create a second record', async () => {
    const e1 = await engine.recordEvent({ source: 'subagent/end', dedupe_key: 'run:1' })
    expect(e1.duplicate).toBe(false)
    const e2 = await engine.recordEvent({ source: 'subagent/end', dedupe_key: 'run:1' })
    expect(e2.duplicate).toBe(true)
    expect(e2.record.id).toBe(e1.record.id)
    expect((await engine.listEvents()).length).toBe(1)
  })

  it('persists effects across a fresh engine instance (no blind replay)', async () => {
    const fx = await engine.enqueueEffect({ kind: 'http', payload: { url: 'x' } })
    expect(fx.status).toBe('pending')
    const done = await engine.completeEffect(fx.id)
    expect(done.status).toBe('done')
    const unknownFx = await engine.enqueueEffect({ kind: 'http', payload: { url: 'y' } })
    await engine.markEffectUnknown(unknownFx.id)
    // fresh engine = simulated restart, same root
    const reopened = new PrismEngine(root)
    const list = await reopened.listEffects()
    expect(list.find((e) => e.id === fx.id)?.status).toBe('done')
    expect(list.find((e) => e.id === unknownFx.id)?.status).toBe('unknown')
  })

  it('refuses to replay an unknown effect without verification', async () => {
    const fx = await engine.enqueueEffect({ kind: 'http', payload: {} })
    await engine.markEffectUnknown(fx.id)
    await expect(engine.replayEffect(fx.id)).rejects.toThrow(/unknown|verify|check/i)
    // a done effect is a no-op replay
    const done = await engine.enqueueEffect({ kind: 'http', payload: {} })
    await engine.completeEffect(done.id)
    expect((await engine.replayEffect(done.id)).status).toBe('done')
  })

  it('tracks execution records with an output cursor', async () => {
    const { intent, mandate } = await seedIntentAndMandate()
    const a = await engine.createAssignment({ intent_id: intent.id, mandate_id: mandate.id, backend: 'local' })
    const ex = await engine.createExecution({ assignment_id: a.id, job_ref: 'job-1', side_effect: 'read' })
    expect(ex.output_cursor).toBe(0)
    const mid = await engine.updateExecution(ex.id, { output_cursor: 50 })
    expect(mid.output_cursor).toBe(50)
    const fin = await engine.updateExecution(ex.id, { status: 'done', result: 'ok' })
    expect(fin.status).toBe('done')
    expect(fin.result).toBe('ok')
  })

  it('marks running assignments as interrupted on recovery', async () => {
    const { intent, mandate } = await seedIntentAndMandate()
    const a = await engine.createAssignment({ intent_id: intent.id, mandate_id: mandate.id, backend: 'local' })
    await engine.setAssignmentStatus(a.id, 'running')
    const reopened = new PrismEngine(root)
    const paused = await reopened.recoverAssignments()
    expect(paused).toContain(a.id)
    expect((await reopened.getAssignment(a.id)).status).toBe('interrupted')
  })
})
