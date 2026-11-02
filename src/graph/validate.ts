// Read-only integrity audit: schema, references, dependencies and result links.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { COUNTER_KINDS, FactSchema, IntentSchema, ProjectSchema, type Fact, type Intent } from './types'

export interface ValidationReport {
  ok: boolean
  errors: string[]
  warnings: string[]
}

async function readNodes<T>(
  dir: string,
  schema: z.ZodType<T>,
  kind: string,
  errors: string[]
): Promise<T[]> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const seen = new Set<string>()
  const out: T[] = []
  for (const f of files) {
    try {
      const parsed = schema.parse(JSON.parse(await readFile(join(dir, f), 'utf8')))
      const id = (parsed as unknown as { id?: string }).id
      if (id && f !== `${id}.json`) {
        errors.push(`${kind} file ${f} declares id '${id}' (filename mismatch)`)
      }
      if (id && seen.has(id)) {
        errors.push(`${kind} duplicate id '${id}'`)
        continue
      }
      if (id) seen.add(id)
      out.push(parsed)
    } catch (err) {
      errors.push(`${kind} file ${f} is invalid: ${(err as Error).message}`)
    }
  }
  return out
}

export async function validateGraph(root: string): Promise<ValidationReport> {
  const errors: string[] = []
  const warnings: string[] = []

  let project
  try {
    project = ProjectSchema.parse(JSON.parse(await readFile(join(root, 'project.json'), 'utf8')))
  } catch (err) {
    errors.push(`project.json invalid: ${(err as Error).message}`)
    return { ok: false, errors, warnings }
  }

  for (const k of COUNTER_KINDS) {
    if (typeof project.counters[k] !== 'number') errors.push(`project counters missing '${k}'`)
  }

  const facts = await readNodes<Fact>(join(root, 'facts'), FactSchema, 'fact', errors)
  const intents = await readNodes<Intent>(join(root, 'intents'), IntentSchema, 'intent', errors)
  const factIds = new Set(facts.map((f) => f.id))

  for (const i of intents) {
    for (const from of i.from) {
      if (!factIds.has(from)) errors.push(`intent ${i.id} from-fact ${from} does not exist`)
    }
    if (i.to !== null && i.to !== 'goal' && !factIds.has(i.to)) {
      errors.push(`intent ${i.id} result ${i.to} does not exist`)
    }
    if (i.from.length > 0 && !i.from.every((f) => f !== i.id)) {
      // no-op guard; intents reference facts, not intents
    }
  }

  if (project.status === 'done' && !intents.some((i) => i.to === 'goal')) {
    warnings.push("project marked 'done' but no intent targets the goal")
  }

  return { ok: errors.length === 0, errors, warnings }
}
