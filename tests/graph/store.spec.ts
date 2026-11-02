import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GraphStore } from '../../src/graph/store'

let dir: string
let store: GraphStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prism-store-'))
  store = new GraphStore(join(dir, '.prism'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('GraphStore: init / facts / immutability / recall', () => {
  it('init writes project.json and the goal fact', async () => {
    await store.init('acme', 'find auth bypass')
    const project = await store.loadProject()
    expect(project.id).toBe('proj')
    expect(project.goal).toBe('find auth bypass')
    expect(project.status).toBe('active')
    const goal = await store.getFact('goal')
    expect(goal.title).toContain('find auth bypass')
  })

  it('adds facts with sequential zero-padded ids', async () => {
    await store.init('acme', 'g')
    const f1 = await store.addFact({ title: 'a', summary: 'sa', creator: 'w' })
    const f2 = await store.addFact({ title: 'b', summary: 'sb', creator: 'w' })
    expect(f1.id).toBe('f001')
    expect(f2.id).toBe('f002')
    expect((await store.listFacts()).map((f) => f.id)).toEqual(['goal', 'f001', 'f002'])
  })

  it('facts are immutable: re-saving an existing id is rejected', async () => {
    await store.init('acme', 'g')
    const f = await store.addFact({ title: 'a', summary: 's', creator: 'w' })
    await expect(store.saveFact({ ...f, summary: 'changed' })).rejects.toThrow(/immutable|exist/i)
  })

  it('recall returns only id/title/summary (no raw evidence)', async () => {
    await store.init('acme', 'g')
    await store.addFact({ title: 'leak', summary: 'aws key exposed', creator: 'w', evidence: ['e001'] })
    const recall = await store.recallFacts()
    expect(recall).toEqual([{ id: 'f001', title: 'leak', summary: 'aws key exposed' }])
  })

  it('adds intents and reads them back', async () => {
    await store.init('acme', 'g')
    const f = await store.addFact({ title: 'a', summary: 's', creator: 'w' })
    const i = await store.addIntent({ description: 'probe', from: [f.id] })
    expect(i.id).toBe('i001')
    expect(i.from).toEqual(['f001'])
    expect((await store.getIntent('i001')).description).toBe('probe')
  })

  it('a corrupted fact file throws on read instead of crashing silently', async () => {
    await store.init('acme', 'g')
    await writeFile(join(dir, '.prism', 'facts', 'f999.json'), '{not json', 'utf8')
    await expect(store.getFact('f999')).rejects.toThrow()
  })

  it('atomic write leaves no temp files behind', async () => {
    await store.init('acme', 'g')
    await store.addFact({ title: 'a', summary: 's', creator: 'w' })
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(join(dir, '.prism', 'facts'))
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false)
  })
})
