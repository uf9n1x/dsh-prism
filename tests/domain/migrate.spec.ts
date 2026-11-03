import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate, CURRENT_SCHEMA_VERSION } from '../../src/domain/migrate'

let root: string

beforeEach(async () => {
  root = join(await mkdtemp(join(tmpdir(), 'prism-mig-')), '.prism')
  await mkdir(join(root, 'facts'), { recursive: true })
})
afterEach(async () => {
  await rm(join(root, '..'), { recursive: true, force: true })
})

const legacyProject = (extra: Record<string, unknown> = {}) => ({
  id: 'proj',
  origin: 'acme',
  authorization: 'SOE',
  goal: 'g',
  status: 'active',
  counters: { fact: 0, intent: 0, hint: 0, worker: 0, message: 0, evidence: 0 },
  created_at: '2026-11-01T00:00:00.000Z',
  ...extra
})

describe('schema migration', () => {
  it('adds schema_version to a legacy project.json that lacks it', async () => {
    await writeFile(join(root, 'project.json'), JSON.stringify(legacyProject()), 'utf8')
    const v = await migrate(root)
    expect(v).toBe(CURRENT_SCHEMA_VERSION)
    const saved = JSON.parse(await readFile(join(root, 'project.json'), 'utf8'))
    expect(saved.schema_version).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('is idempotent: running twice yields the same version', async () => {
    await writeFile(join(root, 'project.json'), JSON.stringify(legacyProject()), 'utf8')
    const a = await migrate(root)
    const b = await migrate(root)
    expect(a).toBe(b)
    expect(b).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('leaves an already-current project at the current version', async () => {
    await writeFile(
      join(root, 'project.json'),
      JSON.stringify(legacyProject({ schema_version: CURRENT_SCHEMA_VERSION })),
      'utf8'
    )
    expect(await migrate(root)).toBe(CURRENT_SCHEMA_VERSION)
  })
})
