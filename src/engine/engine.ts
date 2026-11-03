// PrismEngine — the ONLY domain writer for a `.prism/` engagement.
//
// Every control tool, worker report, event-runtime step and recovery routine
// goes through this class; GraphStore owns persistence and the UI only reads a
// projection. Keeping a single writer is what makes reference integrity,
// deduplication and the outbox ordering enforceable instead of advisory.
import { join } from 'node:path'
import { mkdir, readdir } from 'node:fs/promises'
import { GraphStore } from '../graph/store.js'
import { atomicWriteJson, existsPath, readJson } from '../graph/lock.js'
import { ENTITY_DIRS, type Intent } from '../graph/types.js'
import {
  ASSIGNMENT_STATUSES,
  AssignmentSchema,
  ACTIVE_ASSIGNMENT_STATUSES,
  EffectSchema,
  EventRecordSchema,
  ExecutionRecordSchema,
  MandateSchema,
  ReportSchema,
  migrate,
  CURRENT_SCHEMA_VERSION,
  type Assignment,
  type AssignmentStatus,
  type Backend,
  type Effect,
  type EventRecord,
  type ExecutionRecord,
  type Mandate,
  type MandateScope,
  type MandateStrength,
  type Report,
  type ReportKind
} from '../domain/index.js'

const nowIso = () => new Date().toISOString()

/** Actions whose execution always needs a human confirmation, at any mandate strength. */
export const HIGH_RISK_ACTIONS = ['exploit', 'credential', 'write', 'submit', 'exfil', 'modify'] as const

/** Mandate strengths that always require confirmation, regardless of the action name. */
const CONFIRM_STRENGTHS: readonly MandateStrength[] = ['write', 'exploit']

/** Allowed assignment transitions; anything else is a programming error, not a domain event. */
const TRANSITIONS: Record<AssignmentStatus, readonly AssignmentStatus[]> = {
  spawned: ['running', 'paused', 'cancelled', 'failed', 'interrupted'],
  running: ['waiting', 'ready', 'done', 'failed', 'paused', 'cancelled', 'interrupted'],
  waiting: ['running', 'ready', 'done', 'failed', 'paused', 'cancelled', 'interrupted'],
  ready: ['running', 'done', 'failed', 'paused', 'cancelled', 'interrupted'],
  paused: ['running', 'cancelled', 'failed', 'interrupted'],
  interrupted: ['running', 'cancelled', 'failed'],
  done: [],
  failed: [],
  cancelled: []
}

export interface CreateMandateInput {
  policy_version: string
  scope: MandateScope
  strength: MandateStrength
  source: string
  basis: string
}

export interface CreateAssignmentInput {
  intent_id: string
  mandate_id: string
  backend: Backend
  worker_session?: string | null
  resume_of?: string | null
}

export interface AddReportInput {
  assignment_id: string
  kind: ReportKind
  text: string
  facts?: string[]
  evidence?: string[]
}

export interface RecordEventInput {
  source: string
  dedupe_key: string
  owner_session?: string | null
}

export interface EnqueueEffectInput {
  kind: string
  payload?: Record<string, unknown>
  idempotent?: boolean
  refs?: string[]
}

export interface AuthorizeRequest {
  assignment_id: string
  action: string
  target?: string
  backend?: Backend
  /** A human approval already collected by the host for this exact action. */
  confirmed?: boolean
}

export interface Decision {
  allowed: boolean
  requiresConfirm: boolean
  reason?: string
}

export interface RevocationRecord {
  mandate_id: string
  reason: string
  revoked_at: string
  paused: string[]
}

export class PrismEngine {
  readonly root: string
  readonly store: GraphStore

  constructor(root: string) {
    this.root = root
    this.store = new GraphStore(root)
  }

  // -- lifecycle -----------------------------------------------------------

  /** Create a fresh engagement: schema-versioned graph plus every entity directory. */
  async init(origin: string, goal: string, authorization = ''): Promise<void> {
    await mkdir(this.root, { recursive: true })
    for (const dir of Object.values(ENTITY_DIRS)) {
      await mkdir(join(this.root, dir), { recursive: true })
    }
    const created = await this.store.init(origin, goal, authorization)
    await migrate(this.root)
    return void created
  }

  async exists(): Promise<boolean> {
    return this.store.exists()
  }

  /** Open an existing engagement, migrating it to the current schema version. */
  async open(): Promise<number> {
    return migrate(this.root)
  }

  // -- mandates (immutable credentials) ------------------------------------

  async createMandate(input: CreateMandateInput): Promise<Mandate> {
    if (input.scope.targets.length === 0 && input.scope.actions.length === 0) {
      throw new Error('a mandate must scope at least one target or action')
    }
    const id = await this.store.nextId('mandate', 'md', ENTITY_DIRS.mandates)
    const mandate = MandateSchema.parse({
      id,
      policy_version: input.policy_version,
      scope: input.scope,
      strength: input.strength,
      source: input.source,
      basis: input.basis,
      created_at: nowIso()
    })
    await this.store.writeEntity(ENTITY_DIRS.mandates, id, mandate)
    return mandate
  }

  async getMandate(id: string): Promise<Mandate> {
    const m = await this.store.readEntityOrNull<Mandate>(ENTITY_DIRS.mandates, id, MandateSchema)
    if (m === null) throw new Error(`unknown mandate ${id}`)
    return m
  }

  async listMandates(): Promise<Mandate[]> {
    return this.store.listEntities(ENTITY_DIRS.mandates, MandateSchema)
  }

  async isRevoked(mandateId: string): Promise<boolean> {
    return existsPath(join(this.root, ENTITY_DIRS.revocations, `${mandateId}.json`))
  }

  /**
   * Revoke a mandate and pause every affected live assignment in one step.
   * Mandates are immutable, so revocation is a separate record — history stays
   * readable and a replayed event can never resurrect the credential.
   */
  async revokeMandate(mandateId: string, reason = 'revoked'): Promise<RevocationRecord> {
    await this.getMandate(mandateId)
    const assignments = await this.listAssignments()
    const affected = assignments.filter(
      (a) => a.mandate_id === mandateId && ACTIVE_ASSIGNMENT_STATUSES.includes(a.status)
    )
    const record: RevocationRecord = {
      mandate_id: mandateId,
      reason,
      revoked_at: nowIso(),
      paused: affected.map((a) => a.id)
    }
    await this.store.writeEntity(ENTITY_DIRS.revocations, mandateId, record)
    for (const a of affected) {
      await this.setAssignmentStatus(a.id, 'paused')
    }
    return record
  }

  /** Replace a mandate with a narrower one: new immutable credential + revocation of the old. */
  async supersedeMandate(oldId: string, next: CreateMandateInput, reason = 'tightened'): Promise<Mandate> {
    const mandate = await this.createMandate(next)
    await this.revokeMandate(oldId, reason)
    return mandate
  }

  // -- assignments ---------------------------------------------------------

  async createAssignment(input: CreateAssignmentInput): Promise<Assignment> {
    const intent = await this.store.getIntent(input.intent_id).catch(() => null)
    const mandate = await this.store
      .readEntityOrNull(ENTITY_DIRS.mandates, input.mandate_id, MandateSchema)
      .catch(() => null)
    if (intent === null) throw new Error(`unknown intent ${input.intent_id} for assignment`)
    if (mandate === null) throw new Error(`unknown mandate ${input.mandate_id} for assignment`)
    if (!mandate.scope.backends.includes(input.backend)) {
      throw new Error(`mandate ${mandate.id} does not authorize backend ${input.backend}`)
    }
    const id = await this.store.nextId('assignment', 'a', ENTITY_DIRS.assignments)
    const t = nowIso()
    const assignment = AssignmentSchema.parse({
      id,
      intent_id: input.intent_id,
      mandate_id: input.mandate_id,
      backend: input.backend,
      worker_session: input.worker_session ?? null,
      status: 'spawned',
      attempts: 0,
      resume_of: input.resume_of ?? null,
      created_at: t,
      updated_at: t
    })
    await this.store.writeEntity(ENTITY_DIRS.assignments, id, assignment)
    return assignment
  }

  async getAssignment(id: string): Promise<Assignment> {
    const a = await this.store.readEntityOrNull(ENTITY_DIRS.assignments, id, AssignmentSchema)
    if (a === null) throw new Error(`unknown assignment ${id}`)
    return a
  }

  async listAssignments(): Promise<Assignment[]> {
    return this.store.listEntities(ENTITY_DIRS.assignments, AssignmentSchema)
  }

  async setAssignmentStatus(
    id: string,
    status: AssignmentStatus,
    patch: Partial<Assignment> = {}
  ): Promise<Assignment> {
    if (!ASSIGNMENT_STATUSES.includes(status)) throw new Error(`unknown assignment status ${status}`)
    const current = await this.getAssignment(id)
    if (current.status !== status && !TRANSITIONS[current.status].includes(status)) {
      throw new Error(`illegal assignment transition ${current.status} -> ${status} for ${id}`)
    }
    const next = AssignmentSchema.parse({
      ...current,
      ...patch,
      id: current.id,
      status,
      updated_at: nowIso()
    })
    await this.store.writeEntity(ENTITY_DIRS.assignments, id, next)
    return next
  }

  /** Attach the native subagent session id to an assignment (spawn acknowledged). */
  async bindWorkerSession(id: string, workerSession: string): Promise<Assignment> {
    return this.setAssignmentStatus(id, 'running', {
      worker_session: workerSession,
      attempts: (await this.getAssignment(id)).attempts + 1
    })
  }

  /**
   * Restart reconciliation: a live assignment cannot survive a process exit, so
   * every non-terminal attempt is marked `interrupted` (never `failed`, which
   * would claim a verdict the engine did not observe).
   */
  async recoverAssignments(): Promise<string[]> {
    const assignments = await this.listAssignments()
    const interrupted: string[] = []
    for (const a of assignments) {
      if (!ACTIVE_ASSIGNMENT_STATUSES.includes(a.status)) continue
      const next = AssignmentSchema.parse({
        ...a,
        status: 'interrupted',
        updated_at: nowIso()
      })
      await this.store.writeEntity(ENTITY_DIRS.assignments, a.id, next)
      interrupted.push(a.id)
    }
    return interrupted
  }

  // -- reports -------------------------------------------------------------

  async addReport(input: AddReportInput): Promise<Report> {
    const assignment = await this.store
      .readEntityOrNull<Assignment>(ENTITY_DIRS.assignments, input.assignment_id, AssignmentSchema)
      .catch(() => null)
    if (assignment === null) {
      throw new Error(`unknown assignment ${input.assignment_id} for report`)
    }
    if (input.kind === 'cancelled' || input.kind === 'failed') {
      // report only records intent; the assignment transition is a separate domain commit
    }
    const id = await this.store.nextId('report', 'r', ENTITY_DIRS.reports)
    const report = ReportSchema.parse({
      id,
      assignment_id: input.assignment_id,
      kind: input.kind,
      text: input.text,
      facts: input.facts ?? [],
      evidence: input.evidence ?? [],
      created_at: nowIso()
    })
    await this.store.writeEntity(ENTITY_DIRS.reports, id, report)
    return report
  }

  async listReports(): Promise<Report[]> {
    return this.store.listEntities(ENTITY_DIRS.reports, ReportSchema)
  }

  // -- events (persist first, then route) ----------------------------------

  /**
   * Persist an event record. A repeated `dedupe_key` returns the existing record
   * with `duplicate: true` and writes nothing, so no downstream step can create
   * a second intent or assignment from the same source event.
   */
  async recordEvent(input: RecordEventInput): Promise<{ record: EventRecord; duplicate: boolean }> {
    const events = await this.listEvents()
    const existing = events.find((e) => e.dedupe_key === input.dedupe_key)
    if (existing !== undefined) return { record: existing, duplicate: true }
    const id = await this.store.nextId('event', 'v', ENTITY_DIRS.events)
    const record = EventRecordSchema.parse({
      id,
      source: input.source,
      dedupe_key: input.dedupe_key,
      owner_session: input.owner_session ?? null,
      status: 'pending',
      filter_reason: null,
      created_at: nowIso()
    })
    await this.store.writeEntity(ENTITY_DIRS.events, id, record)
    return { record, duplicate: false }
  }

  async listEvents(): Promise<EventRecord[]> {
    return this.store.listEntities(ENTITY_DIRS.events, EventRecordSchema)
  }

  async markEvent(
    id: string,
    patch: { status?: EventRecord['status']; filter_reason?: string | null; owner_session?: string | null }
  ): Promise<EventRecord> {
    const existing = await this.store.readEntityOrNull<EventRecord>(ENTITY_DIRS.events, id, EventRecordSchema)
    if (existing === null) throw new Error(`unknown event ${id}`)
    const next = EventRecordSchema.parse({ ...existing, ...patch, id: existing.id })
    await this.store.writeEntity(ENTITY_DIRS.events, id, next)
    return next
  }

  // -- effects / outbox ----------------------------------------------------

  async enqueueEffect(input: EnqueueEffectInput): Promise<Effect> {
    const id = await this.store.nextId('effect', 'x', ENTITY_DIRS.effects)
    const effect = EffectSchema.parse({
      id,
      kind: input.kind,
      payload: input.payload ?? {},
      status: 'pending',
      attempts: 0,
      idempotent: input.idempotent ?? false,
      refs: input.refs ?? [],
      created_at: nowIso()
    })
    await this.store.writeEntity(ENTITY_DIRS.effects, id, effect)
    return effect
  }

  async getEffect(id: string): Promise<Effect> {
    const effect = await this.store.readEntityOrNull<Effect>(ENTITY_DIRS.effects, id, EffectSchema)
    if (effect === null) throw new Error(`unknown effect ${id}`)
    return effect
  }

  async listEffects(): Promise<Effect[]> {
    return this.store.listEntities(ENTITY_DIRS.effects, EffectSchema)
  }

  /** Effects that may run now: pending only. `unknown` never appears here. */
  async claimableEffects(): Promise<Effect[]> {
    return (await this.listEffects()).filter((e) => e.status === 'pending')
  }

  async completeEffect(id: string): Promise<Effect> {
    return this.patchEffect(id, { status: 'done', attempts: (await this.getEffect(id)).attempts + 1 })
  }

  async failEffect(id: string, reason?: string): Promise<Effect> {
    const current = await this.getEffect(id)
    return this.patchEffect(id, {
      status: 'failed',
      attempts: current.attempts + 1,
      ...(reason === undefined ? {} : { payload: { ...current.payload, error: reason } })
    })
  }

  /**
   * Mark an effect whose outcome could not be observed. `unknown` is a terminal
   * state for automatic dispatch: the only exits are an explicit verified
   * resolution, never a replay.
   */
  async markEffectUnknown(id: string, reason = 'outcome not observed'): Promise<Effect> {
    const current = await this.getEffect(id)
    return this.patchEffect(id, {
      status: 'unknown',
      payload: { ...current.payload, unknown_reason: reason }
    })
  }

  /** Resolve an `unknown` effect after an external check, without re-running it. */
  async resolveUnknownEffect(id: string, outcome: 'done' | 'failed', note: string): Promise<Effect> {
    const current = await this.getEffect(id)
    if (current.status !== 'unknown') {
      throw new Error(`effect ${id} is ${current.status}, not unknown; nothing to resolve`)
    }
    return this.patchEffect(id, {
      status: outcome,
      payload: { ...current.payload, resolved_note: note }
    })
  }

  /**
   * Replay an effect. A `done` effect is a no-op (idempotent by construction);
   * an `unknown` effect must be verified first — replaying it could repeat an
   * external side effect whose first attempt already landed.
   */
  async replayEffect(id: string): Promise<Effect> {
    const current = await this.getEffect(id)
    if (current.status === 'done') return current
    if (current.status === 'unknown') {
      throw new Error(
        `effect ${id} has an unknown outcome; verify it externally and resolve it before any replay`
      )
    }
    return this.patchEffect(id, { status: 'pending', attempts: current.attempts + 1 })
  }

  private async patchEffect(id: string, patch: Partial<Effect>): Promise<Effect> {
    const current = await this.getEffect(id)
    const next = EffectSchema.parse({ ...current, ...patch, id: current.id, updated_at: nowIso() })
    await this.store.writeEntity(ENTITY_DIRS.effects, id, next)
    return next
  }

  // -- executions ----------------------------------------------------------

  async createExecution(input: {
    assignment_id: string
    job_ref?: string | null
    side_effect?: ExecutionRecord['side_effect']
  }): Promise<ExecutionRecord> {
    await this.getAssignment(input.assignment_id)
    const id = await this.store.nextId('execution', 'x', ENTITY_DIRS.executions)
    const record = ExecutionRecordSchema.parse({
      id,
      assignment_id: input.assignment_id,
      job_ref: input.job_ref ?? null,
      status: 'running',
      output_cursor: 0,
      side_effect: input.side_effect ?? 'none',
      result: null,
      created_at: nowIso()
    })
    await this.store.writeEntity(ENTITY_DIRS.executions, id, record)
    return record
  }

  async updateExecution(id: string, patch: Partial<ExecutionRecord>): Promise<ExecutionRecord> {
    const current = await this.store.readEntityOrNull<ExecutionRecord>(ENTITY_DIRS.executions, id, ExecutionRecordSchema)
    if (current === null) throw new Error(`unknown execution ${id}`)
    const next = ExecutionRecordSchema.parse({
      ...current,
      ...patch,
      id: current.id,
      updated_at: nowIso()
    })
    await this.store.writeEntity(ENTITY_DIRS.executions, id, next)
    return next
  }

  async listExecutions(): Promise<ExecutionRecord[]> {
    return this.store.listEntities(ENTITY_DIRS.executions, ExecutionRecordSchema)
  }

  // -- authorization (Host-enforced) ---------------------------------------

  /**
   * Decide whether one action may execute. This is the deterministic gate the
   * tools call before every execution: model prose, a `confirm` intent or a
   * report cannot grant authority — only a live mandate can.
   */
  async authorize(request: AuthorizeRequest): Promise<Decision> {
    const assignment = await this.store
      .readEntityOrNull<Assignment>(ENTITY_DIRS.assignments, request.assignment_id, AssignmentSchema)
      .catch(() => null)
    if (assignment === null) {
      return { allowed: false, requiresConfirm: false, reason: `unknown assignment ${request.assignment_id}` }
    }
    if (assignment.status === 'paused') {
      return { allowed: false, requiresConfirm: false, reason: 'assignment is paused (authorization withdrawn)' }
    }
    if (assignment.status === 'cancelled' || assignment.status === 'failed' || assignment.status === 'done') {
      return { allowed: false, requiresConfirm: false, reason: `assignment is ${assignment.status}; no further work` }
    }
    const mandate = await this.store
      .readEntityOrNull(ENTITY_DIRS.mandates, assignment.mandate_id, MandateSchema)
      .catch(() => null)
    if (mandate === null) {
      return { allowed: false, requiresConfirm: false, reason: `unknown mandate ${assignment.mandate_id}` }
    }
    if (await this.isRevoked(mandate.id)) {
      return { allowed: false, requiresConfirm: false, reason: `mandate ${mandate.id} is revoked; assignment is paused` }
    }
    if (!mandate.scope.actions.includes(request.action)) {
      return {
        allowed: false,
        requiresConfirm: false,
        reason: `action "${request.action}" is outside mandate ${mandate.id} scope`
      }
    }
    const backend = request.backend ?? assignment.backend
    if (!mandate.scope.backends.includes(backend)) {
      return { allowed: false, requiresConfirm: false, reason: `backend "${backend}" is outside mandate scope` }
    }
    if (request.target !== undefined) {
      if (mandate.scope.targets.length === 0) {
        return { allowed: false, requiresConfirm: false, reason: 'mandate names no targets' }
      }
      if (!mandate.scope.targets.includes(request.target)) {
        return { allowed: false, requiresConfirm: false, reason: `target "${request.target}" is outside mandate scope` }
      }
    }
    const requiresConfirm =
      CONFIRM_STRENGTHS.includes(mandate.strength) ||
      (HIGH_RISK_ACTIONS as readonly string[]).includes(request.action)
    if (requiresConfirm && request.confirmed !== true) {
      return { allowed: true, requiresConfirm: true, reason: `action "${request.action}" requires confirmation` }
    }
    return { allowed: true, requiresConfirm: false }
  }

  // -- integrity -----------------------------------------------------------

  /** Reference integrity audit across the domain records. */
  async audit(): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = []
    const intents = await this.store.listIntents().catch((): Intent[] => [])
    const intentIds = new Set(intents.map((i) => i.id))
    const mandates = await this.listMandates()
    const mandateIds = new Set(mandates.map((m) => m.id))
    const assignments = await this.listAssignments()
    const assignmentIds = new Set(assignments.map((a) => a.id))
    for (const a of assignments) {
      if (!intentIds.has(a.intent_id)) errors.push(`assignment ${a.id} references missing intent ${a.intent_id}`)
      if (!mandateIds.has(a.mandate_id)) errors.push(`assignment ${a.id} references missing mandate ${a.mandate_id}`)
    }
    for (const r of await this.listReports()) {
      if (!assignmentIds.has(r.assignment_id)) errors.push(`report ${r.id} references missing assignment ${r.assignment_id}`)
    }
    for (const x of await this.listExecutions()) {
      if (!assignmentIds.has(x.assignment_id)) errors.push(`execution ${x.id} references missing assignment ${x.assignment_id}`)
    }
    return { ok: errors.length === 0, errors }
  }

  /** Current schema version on disk (0 for a legacy graph). */
  async schemaVersion(): Promise<number> {
    try {
      const raw = JSON.parse(await readJson(join(this.root, 'project.json'))) as { schema_version?: number }
      return raw.schema_version ?? 0
    } catch {
      return 0
    }
  }

  /** Test/ops helper: write a record at a caller-chosen id (imports, fixtures). */
  async importEntity(dirName: string, id: string, value: unknown): Promise<void> {
    await atomicWriteJson(join(this.root, dirName, `${id}.json`), value)
  }

  static readonly CURRENT_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION

  /** Directory listing helper for projection/audit (read-only). */
  async listDir(dirName: string): Promise<string[]> {
    try {
      return (await readdir(join(this.root, dirName))).filter((f) => f.endsWith('.json'))
    } catch {
      return []
    }
  }
}
