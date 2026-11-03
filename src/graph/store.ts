// GraphStore — authoritative `.prism/` storage. One file per node, atomic writes,
// Windows-safe lock around the (allocate id → write node → update counters) critical
// section. Facts are append-only (immutable). Reads validate with zod.
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteJson, existsPath, readJson, withLock } from './lock.js'
import { CURRENT_SCHEMA_VERSION } from '../domain/migrate.js'
import {
  COUNTER_KINDS,
  ENTITY_DIRS,
  FactSchema,
  IntentSchema,
  ProjectSchema,
  type Fact,
  type Intent,
  type Project
} from './types.js'
import type { z } from 'zod'

const nowIso = () => new Date().toISOString()
const pad = (n: number) => String(n).padStart(3, '0')

export interface AddFactInput {
  title: string
  summary: string
  creator: string
  source_intent?: string | null
  evidence?: string[]
}
export interface AddIntentInput {
  description: string
  from?: string[]
  to?: string | null
  confirm?: boolean
  approved?: boolean
  backend?: 'local' | 'kali'
  stop_condition?: string | null
}
export interface FactRecall {
  id: string
  title: string
  summary: string
}

function orderKey(id: string): number {
  if (id === 'goal') return 0
  const m = /(\d+)$/.exec(id)
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
}

export class GraphStore {
  readonly root: string
  constructor(root: string) {
    this.root = root
  }

  get projectFile(): string {
    return join(this.root, 'project.json')
  }
  get factsDir(): string {
    return join(this.root, 'facts')
  }
  get intentsDir(): string {
    return join(this.root, 'intents')
  }
  get lockPath(): string {
    return join(this.root, '.lock')
  }

  async exists(): Promise<boolean> {
    return existsPath(this.projectFile)
  }

  async init(origin: string, goal: string, authorization = ''): Promise<Project> {
    await mkdir(this.factsDir, { recursive: true })
    await mkdir(this.intentsDir, { recursive: true })
    for (const dir of Object.values(ENTITY_DIRS)) {
      await mkdir(join(this.root, dir), { recursive: true })
    }
    return withLock(this.lockPath, async () => {
      if (await this.exists()) throw new Error(`prism graph already exists at ${this.root}`)
      const t = nowIso()
      const counters: Record<string, number> = {}
      for (const k of COUNTER_KINDS) counters[k] = 0
      const project = ProjectSchema.parse({
        id: 'proj',
        origin,
        authorization,
        goal,
        status: 'active',
        counters,
        schema_version: CURRENT_SCHEMA_VERSION,
        created_at: t,
        updated_at: t
      })
      await atomicWriteJson(this.projectFile, project)
      const goalFact = FactSchema.parse({
        id: 'goal',
        title: `goal: ${goal}`,
        summary: goal,
        evidence: [],
        creator: 'system',
        source_intent: null,
        created_at: t
      })
      await atomicWriteJson(join(this.factsDir, 'goal.json'), goalFact)
      return project
    })
  }

  async loadProject(): Promise<Project> {
    const raw = await readJson(this.projectFile)
    return ProjectSchema.parse(raw)
  }

  private async saveProject(p: Project): Promise<void> {
    await atomicWriteJson(this.projectFile, ProjectSchema.parse({ ...p, updated_at: nowIso() }))
  }

  /** Must be called inside the lock. */
  private async allocate(kind: string, prefix: string, dir?: string): Promise<string> {
    const project = await this.loadProject()
    let n = (project.counters[kind] ?? 0) + 1
    while (dir && (await existsPath(join(dir, `${prefix}${pad(n)}.json`)))) n += 1
    project.counters[kind] = n
    await this.saveProject(project)
    return `${prefix}${pad(n)}`
  }

  // -- facts (append-only / immutable) --
  async addFact(input: AddFactInput): Promise<Fact> {
    return withLock(this.lockPath, async () => {
      const id = await this.allocate('fact', 'f', this.factsDir)
      const fact = FactSchema.parse({
        id,
        title: input.title,
        summary: input.summary,
        evidence: input.evidence ?? [],
        creator: input.creator,
        source_intent: input.source_intent ?? null,
        created_at: nowIso()
      })
      await atomicWriteJson(join(this.factsDir, `${id}.json`), fact)
      return fact
    })
  }

  /** Import a fully-formed fact; refuses to overwrite (immutability guard). */
  async saveFact(fact: Fact): Promise<void> {
    return withLock(this.lockPath, async () => {
      const path = join(this.factsDir, `${fact.id}.json`)
      if (await existsPath(path)) throw new Error(`fact ${fact.id} is immutable: already exists`)
      await atomicWriteJson(path, FactSchema.parse(fact))
    })
  }

  async getFact(id: string): Promise<Fact> {
    try {
      return FactSchema.parse(await readJson(join(this.factsDir, `${id}.json`)))
    } catch (err) {
      throw new Error(`cannot read fact ${id}: ${(err as Error).message}`)
    }
  }

  async listFacts(): Promise<Fact[]> {
    const files = await listJsonFiles(this.factsDir)
    const seen = new Set<string>()
    const out: Fact[] = []
    for (const f of files) {
      const fact = FactSchema.parse(await readJson(join(this.factsDir, f)))
      if (seen.has(fact.id)) continue
      seen.add(fact.id)
      out.push(fact)
    }
    return out.sort((a, b) => orderKey(a.id) - orderKey(b.id))
  }

  /** Recall defaults to title + summary only (never raw evidence). Excludes the goal node. */
  async recallFacts(): Promise<FactRecall[]> {
    const facts = await this.listFacts()
    return facts
      .filter((f) => f.id !== 'goal')
      .map((f) => ({ id: f.id, title: f.title, summary: f.summary }))
  }

  // -- intents --
  async addIntent(input: AddIntentInput): Promise<Intent> {
    return withLock(this.lockPath, async () => {
      const id = await this.allocate('intent', 'i', this.intentsDir)
      const t = nowIso()
      const intent = IntentSchema.parse({
        id,
        description: input.description,
        from: input.from ?? [],
        to: input.to ?? null,
        confirm: input.confirm ?? false,
        approved: input.approved ?? false,
        claimed_by: null,
        backend: input.backend ?? 'local',
        stop_condition: input.stop_condition ?? null,
        created_at: t,
        updated_at: t
      })
      await atomicWriteJson(join(this.intentsDir, `${id}.json`), intent)
      return intent
    })
  }

  async getIntent(id: string): Promise<Intent> {
    try {
      return IntentSchema.parse(await readJson(join(this.intentsDir, `${id}.json`)))
    } catch (err) {
      throw new Error(`cannot read intent ${id}: ${(err as Error).message}`)
    }
  }

  async listIntents(): Promise<Intent[]> {
    const files = await listJsonFiles(this.intentsDir)
    const seen = new Set<string>()
    const out: Intent[] = []
    for (const f of files) {
      const intent = IntentSchema.parse(await readJson(join(this.intentsDir, f)))
      if (seen.has(intent.id)) continue
      seen.add(intent.id)
      out.push(intent)
    }
    return out.sort((a, b) => orderKey(a.id) - orderKey(b.id))
  }

  async updateIntent(id: string, patch: Partial<Intent>): Promise<Intent> {
    return withLock(this.lockPath, async () => {
      const path = join(this.intentsDir, `${id}.json`)
      const current = IntentSchema.parse(await readJson(path))
      const next = IntentSchema.parse({ ...current, ...patch, id: current.id, updated_at: nowIso() })
      await atomicWriteJson(path, next)
      return next
    })
  }

  // -- generic domain entities (Mandate/Assignment/Report/Event/Effect/Execution) --
  // One file per record, atomic write under the same graph lock. Entities are
  // append-or-replace (domain records carry their own status transitions), while
  // facts stay append-only above.

  entityDir(name: string): string {
    return join(this.root, name)
  }

  /** Allocate the next id for `kind` and persist the counter bump atomically. */
  async nextId(kind: string, prefix: string, dirName: string): Promise<string> {
    return withLock(this.lockPath, () =>
      this.allocate(kind, prefix, this.entityDir(dirName))
    )
  }

  async writeEntity<T>(dirName: string, id: string, value: T): Promise<void> {
    await withLock(this.lockPath, () =>
      atomicWriteJson(join(this.entityDir(dirName), `${id}.json`), value)
    )
  }

  async readEntity<T>(dirName: string, id: string, schema: z.ZodType<T>): Promise<T> {
    const raw = await readJson(join(this.entityDir(dirName), `${id}.json`))
    try {
      return schema.parse(raw)
    } catch (err) {
      throw new Error(`invalid ${dirName} record ${id}: ${(err as Error).message}`)
    }
  }

  async readEntityOrNull<T>(dirName: string, id: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
      return await this.readEntity(dirName, id, schema)
    } catch {
      return null
    }
  }

  async listEntities<T>(dirName: string, schema: z.ZodType<T>): Promise<T[]> {
    const dir = this.entityDir(dirName)
    const files = await listJsonFiles(dir)
    const out: T[] = []
    for (const f of files) {
      out.push(schema.parse(await readJson(join(dir, f))))
    }
    return out.sort((a, b) => {
      const ai = (a as { id?: string }).id ?? ''
      const bi = (b as { id?: string }).id ?? ''
      return orderKey(ai) - orderKey(bi)
    })
  }
}
