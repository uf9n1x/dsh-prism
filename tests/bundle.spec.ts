import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const root = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('bundle scaffold (Phase 0 baseline)', () => {
  it('package.json declares a dsh bundle patch and client', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.name).toBe('dsh-prism')
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(pkg.dsh?.client?.platform).toBe('web')
  })

  it('cordis.patch.yml exists and declares the host + preset rows', () => {
    expect(existsSync(join(root, 'cordis.patch.yml'))).toBe(true)
    const patch = read('cordis.patch.yml')
    expect(patch).toContain('prism-host')
    expect(patch).toContain('prism-preset-root')
  })

  it('the governed docs exist (single source of truth present)', () => {
    for (const f of [
      'docs/SPEC.md',
      'docs/DECISIONS.md',
      'docs/MECHANISMS.md',
      'docs/PLAN.md',
      'docs/ARCHITECTURE.md',
      'docs/ACCEPTANCE.md',
      'docs/STATUS.md'
    ]) {
      expect(existsSync(join(root, f)), `missing ${f}`).toBe(true)
    }
  })
})
