import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parse } from 'yaml'

const root = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const pkg = JSON.parse(read('package.json'))

describe('bundle manifest', () => {
  it('declares the bundle patch list in load order', () => {
    expect(pkg.name).toBe('dsh-prism')
    expect(pkg.dsh?.bundle?.patch).toEqual([
      './cordis.patch.yml',
      './presets/prism.patch.yml',
      './presets/prism-worker.patch.yml'
    ])
  })

  it('every declared patch file exists and parses as an insert list', () => {
    for (const rel of pkg.dsh.bundle.patch as string[]) {
      const abs = join(root, rel)
      expect(existsSync(abs), `missing ${rel}`).toBe(true)
      const doc = parse(readFileSync(abs, 'utf8'))
      expect(Array.isArray(doc), `${rel} must be a patch array`).toBe(true)
      expect(doc.length).toBeGreaterThan(0)
    }
  })

  it('every row name in the shipped patches resolves to this package or a DSH package', () => {
    const rows: { name?: string }[] = []
    for (const rel of pkg.dsh.bundle.patch as string[]) {
      for (const entry of parse(readFileSync(join(root, rel), 'utf8')) as { insert?: { name?: string }[] }[]) {
        for (const row of entry.insert ?? []) rows.push(row)
      }
    }
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.name, 'every row needs a package name').toBeTruthy()
      const name = String(row.name)
      const local = name === 'dsh-prism' || name.startsWith('dsh-prism/')
      const official = name.startsWith('@deepseek-ai/')
      expect(local || official, `unexpected row package ${name}`).toBe(true)
    }
  })

  it('exposes the subpath entries the presets reference', () => {
    expect(pkg.exports['./commander']).toBe('./lib/host/commander.js')
    expect(pkg.exports['./worker']).toBe('./lib/host/worker.js')
    expect(pkg.exports['.']).toBe('./lib/index.js')
    expect(pkg.exports['./presets/*.patch.yml']).toBeTruthy()
  })

  it('ships no client bundle while the five-view UI is unimplemented', () => {
    // Honest manifest: a dsh.client declaration without a real client entry
    // would break the web boot. It is added back when P8 lands.
    expect(pkg.dsh.client).toBeUndefined()
  })

  it('keeps the governed docs present (single source of truth)', () => {
    for (const f of [
      'docs/SPEC.md',
      'docs/DECISIONS.md',
      'docs/MECHANISMS.md',
      'docs/PLAN.md',
      'docs/ARCHITECTURE.md',
      'docs/ACCEPTANCE.md',
      'docs/STATUS.md',
      'docs/DEVLOG.md'
    ]) {
      expect(existsSync(join(root, f)), `missing ${f}`).toBe(true)
    }
  })
})
