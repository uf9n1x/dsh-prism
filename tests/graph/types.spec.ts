import { describe, it, expect } from 'vitest'
import { FactSchema, IntentSchema, ProjectSchema, WorkerSchema } from '../../src/graph/types'

const now = '2026-11-02T00:00:00.000Z'

describe('graph types (zod schemas)', () => {
  it('accepts a minimal fact and applies defaults', () => {
    const f = FactSchema.parse({
      id: 'f001',
      title: 'tcp/80 open',
      summary: 'nginx 1.25 disclosed on 80/tcp',
      creator: 'worker:w001',
      created_at: now
    })
    expect(f.id).toBe('f001')
    expect(f.evidence).toEqual([])
    expect(f.source_intent).toBeNull()
  })

  it('rejects a fact without a title', () => {
    expect(() =>
      FactSchema.parse({ id: 'f002', summary: 'x', creator: 'c', created_at: now })
    ).toThrow()
  })

  it('rejects a fact with an invalid id shape', () => {
    expect(() =>
      FactSchema.parse({ id: 'fact-1', title: 't', summary: 's', creator: 'c', created_at: now })
    ).toThrow()
  })

  it('accepts an intent with defaults', () => {
    const i = IntentSchema.parse({ id: 'i001', description: 'enumerate', created_at: now })
    expect(i.from).toEqual([])
    expect(i.to).toBeNull()
    expect(i.confirm).toBe(false)
    expect(i.approved).toBe(false)
    expect(i.backend).toBe('local')
    expect(i.claimed_by).toBeNull()
  })

  it('rejects an intent with an unknown backend', () => {
    expect(() =>
      IntentSchema.parse({ id: 'i002', description: 'x', backend: 'docker', created_at: now })
    ).toThrow()
  })

  it('project requires a non-empty goal', () => {
    expect(() =>
      ProjectSchema.parse({
        id: 'proj',
        origin: 'acme',
        goal: '',
        created_at: now
      })
    ).toThrow()
  })

  it('worker status is a closed enum', () => {
    expect(() =>
      WorkerSchema.parse({ id: 'w001', status: 'zombie', created_at: now })
    ).toThrow()
    const w = WorkerSchema.parse({ id: 'w002', status: 'running', created_at: now })
    expect(w.backend).toBe('local')
  })
})
