import { describe, it, expect } from 'vitest'
import {
  MandateSchema,
  AssignmentSchema,
  ReportSchema,
  EventRecordSchema,
  EffectSchema,
  ExecutionRecordSchema
} from '../../src/domain'

const now = '2026-11-02T00:00:00.000Z'

describe('domain schemas (zod)', () => {
  it('accepts a minimal mandate and applies defaults', () => {
    const m = MandateSchema.parse({
      id: 'md001',
      policy_version: 'v1',
      scope: { targets: ['10.0.0.5'], actions: ['scan'], backends: ['local'] },
      strength: 'read',
      source: 'user',
      basis: 'engagement SOE #42',
      created_at: now
    })
    expect(m.id).toBe('md001')
    expect(m.scope.actions).toEqual(['scan'])
    expect(m.strength).toBe('read')
  })

  it('rejects a mandate with a bad id or unknown strength', () => {
    expect(() =>
      MandateSchema.parse({ id: 'm1', policy_version: 'v', scope: { targets: [], actions: [], backends: [] }, strength: 'read', source: 's', basis: 'b', created_at: now })
    ).toThrow()
    expect(() =>
      MandateSchema.parse({ id: 'md002', policy_version: 'v', scope: { targets: [], actions: [], backends: [] }, strength: 'god', source: 's', basis: 'b', created_at: now })
    ).toThrow()
  })

  it('accepts an assignment with defaults', () => {
    const a = AssignmentSchema.parse({
      id: 'a001',
      intent_id: 'i001',
      mandate_id: 'md001',
      backend: 'local',
      status: 'spawned',
      created_at: now
    })
    expect(a.attempts).toBe(0)
    expect(a.resume_of).toBeNull()
    expect(a.worker_session).toBeNull()
  })

  it('rejects an assignment with an unknown status', () => {
    expect(() =>
      AssignmentSchema.parse({ id: 'a002', intent_id: 'i', mandate_id: 'md', backend: 'local', status: 'zombie', created_at: now })
    ).toThrow()
  })

  it('accepts a report and defaults arrays', () => {
    const r = ReportSchema.parse({ id: 'r001', assignment_id: 'a001', kind: 'progress', text: 'halfway', created_at: now })
    expect(r.facts).toEqual([])
    expect(r.evidence).toEqual([])
  })

  it('rejects an unknown report kind', () => {
    expect(() =>
      ReportSchema.parse({ id: 'r002', assignment_id: 'a', kind: 'party', text: 'x', created_at: now })
    ).toThrow()
  })

  it('accepts an event record and defaults null fields', () => {
    const e = EventRecordSchema.parse({ id: 'v001', source: 'subagent/end', dedupe_key: 'k1', status: 'pending', created_at: now })
    expect(e.owner_session).toBeNull()
    expect(e.filter_reason).toBeNull()
  })

  it('accepts an effect and defaults', () => {
    const fx = EffectSchema.parse({ id: 'x001', kind: 'http', payload: {}, status: 'pending', created_at: now })
    expect(fx.attempts).toBe(0)
    expect(fx.idempotent).toBe(false)
    expect(fx.refs).toEqual([])
  })

  it('rejects an unknown effect status', () => {
    expect(() =>
      EffectSchema.parse({ id: 'x002', kind: 'http', payload: {}, status: 'exploded', created_at: now })
    ).toThrow()
  })

  it('accepts an execution record and defaults', () => {
    const ex = ExecutionRecordSchema.parse({ id: 'x001', assignment_id: 'a001', status: 'running', created_at: now })
    expect(ex.output_cursor).toBe(0)
    expect(ex.side_effect).toBe('none')
    expect(ex.job_ref).toBeNull()
    expect(ex.result).toBeNull()
  })

  it('rejects an unknown side effect class', () => {
    expect(() =>
      ExecutionRecordSchema.parse({ id: 'x002', assignment_id: 'a', status: 'running', side_effect: 'maybe', created_at: now })
    ).toThrow()
  })
})
