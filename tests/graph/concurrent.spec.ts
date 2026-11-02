import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GraphStore } from '../../src/graph/store'
import { validateGraph } from '../../src/graph/validate'

let dir: string
let store: GraphStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prism-conc-'))
  store = new GraphStore(join(dir, '.prism'))
  await store.init('acme', 'g')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('GraphStore: concurrency safety (Windows-safe lock)', () => {
  it('parallel fact writes never collide on ids and never corrupt files', async () => {
    const N = 20
    const results = await Promise.all(
      Array.from({ length: N }, (_, k) =>
        store.addFact({ title: `t${k}`, summary: `s${k}`, creator: 'w' })
      )
    )
    const ids = results.map((r) => r.id)
    expect(new Set(ids).size).toBe(N)
    const facts = await store.listFacts()
    expect(facts).toHaveLength(N + 1) // + goal
    const report = await validateGraph(store.root)
    expect(report.errors).toEqual([])
  })
})
