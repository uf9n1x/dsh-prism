// Explicit schema migration for `.prism/`. Version is carried on project.json.
// v0 (legacy, no schema_version) -> v1 is a stamp-on-read upgrade; future
// structural changes add their own step functions here.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteJson } from '../graph/lock.js'

export const CURRENT_SCHEMA_VERSION = 1

export async function migrate(root: string): Promise<number> {
  const file = join(root, 'project.json')
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    // No graph yet — nothing to migrate.
    return CURRENT_SCHEMA_VERSION
  }
  const proj = JSON.parse(raw) as Record<string, unknown>
  const current = typeof proj.schema_version === 'number' ? proj.schema_version : 0
  if (current >= CURRENT_SCHEMA_VERSION) return CURRENT_SCHEMA_VERSION
  // Future stepwise migrations would run here for versions < CURRENT.
  proj.schema_version = CURRENT_SCHEMA_VERSION
  await atomicWriteJson(file, proj)
  return CURRENT_SCHEMA_VERSION
}
