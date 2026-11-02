import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GraphStore } from '../../src/graph/store'
import { validateGraph } from '../../src/graph/validate'

let dir: string
let store: GraphStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prism-val-'))
  store = new GraphStore(join(dir, '.prism'))
  await store.init('acme', 'g')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('validateGraph: schema / references / dependencies / result links', () => {
  it('a consistent graph validates ok', async () => {
    const f = await store.addFact({ title: 'a', summary: 's', creator: 'w' })
    await store.addIntent({ description: 'probe', from: [f.id] })
    const report = await validateGraph(store.root)
    expect(report.ok).toBe(true)
    expect(report.errors).toEqual([])
  })

  it('reports a dangling from-fact reference', async () => {
    await store.addIntent({ description: 'probe', from: ['f999'] })
    const report = await validateGraph(store.root)
    expect(report.ok).toBe(false)
    expect(report.errors.join('\n')).toMatch(/f999/)
  })

  it('reports a dangling result (to) reference', async () => {
    const f = await store.addFact({ title: 'a', summary: 's', creator: 'w' })
    await store.addIntent({ description: 'probe', from: [f.id], to: 'f404' })
    const report = await validateGraph(store.root)
    expect(report.ok).toBe(false)
    expect(report.errors.join('\n')).toMatch(/f404/)
  })
})
