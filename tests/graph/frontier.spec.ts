import { describe, it, expect } from 'vitest'
import { classify, readyIntents, type FrontierIntent } from '../../src/graph/frontier'

const facts = [{ id: 'f001' }, { id: 'f002' }]

const base = (over: Partial<FrontierIntent>): FrontierIntent => ({
  id: 'i001',
  to: null,
  from: [],
  confirm: false,
  approved: false,
  claimed_by: null,
  ...over
})

describe('frontier derivation (state encoded in structure)', () => {
  it('open intent whose from-facts all exist is ready', () => {
    const i = base({ from: ['f001', 'f002'] })
    expect(readyIntents([i], facts).map((x) => x.id)).toEqual(['i001'])
  })

  it('intent with a missing dependency is blocked, not ready', () => {
    const i = base({ from: ['f999'] })
    const f = classify([i], facts)
    expect(f.ready).toHaveLength(0)
    expect(f.blocked.map((x) => x.id)).toEqual(['i001'])
  })

  it('a confirm-intent is blocked until approved', () => {
    const i = base({ from: ['f001'], confirm: true, approved: false })
    expect(classify([i], facts).blocked.map((x) => x.id)).toEqual(['i001'])
    const approved = base({ from: ['f001'], confirm: true, approved: true })
    expect(readyIntents([approved], facts).map((x) => x.id)).toEqual(['i001'])
  })

  it('a claimed intent is running, not available', () => {
    const i = base({ from: ['f001'], claimed_by: 'w001' })
    const f = classify([i], facts)
    expect(f.running.map((x) => x.id)).toEqual(['i001'])
    expect(f.available).toHaveLength(0)
  })

  it('a concluded intent (to != null) is done', () => {
    const i = base({ to: 'f002' })
    expect(classify([i], facts).done.map((x) => x.id)).toEqual(['i001'])
  })

  it('available excludes running but includes unclaimed ready', () => {
    const a = base({ id: 'i001', from: ['f001'] })
    const b = base({ id: 'i002', from: ['f001'], claimed_by: 'w001' })
    const f = classify([a, b], facts)
    expect(f.available.map((x) => x.id)).toEqual(['i001'])
  })
})
