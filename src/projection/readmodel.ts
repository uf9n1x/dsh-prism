// Read-only projections of `.prism/`. The commander board, the worker briefing
// and the five Remote views all read these shapes; nothing here writes state.
import { existsPath } from '../graph/lock.js'
import { classify } from '../graph/frontier.js'
import { EvidenceSchema } from '../graph/types.js'
import type { PrismEngine } from '../engine/engine.js'
import { oneLine } from './untrusted.js'

export interface FactView {
  id: string
  title: string
  summary: string
  evidence: string[]
  source_intent: string | null
}

export interface IntentView {
  id: string
  description: string
  from: string[]
  to: string | null
  confirm: boolean
  approved: boolean
  claimed_by: string | null
  backend: string
}

export interface AssignmentView {
  id: string
  intent_id: string
  mandate_id: string
  status: string
  backend: string
  attempts: number
  worker_session: string | null
  resume_of: string | null
}

export interface ReportView {
  id: string
  assignment_id: string
  kind: string
  text: string
  facts: string[]
}

export interface BoardView {
  /** False when no engagement exists in this working directory. */
  present: boolean
  origin: string
  goal: string
  status: string
  schema_version: number
  frontier: {
    ready: IntentView[]
    available: IntentView[]
    running: IntentView[]
    blocked: IntentView[]
    done: IntentView[]
  }
  assignments: AssignmentView[]
  facts: FactView[]
  recent_reports: ReportView[]
  pending_effects: number
  unknown_effects: number
  /** Assignments this open marked `interrupted` (restart reconciliation). */
  recovered: string[]
  /** Cheap totals so nav badges are accurate without fetching every view. */
  counts: {
    facts: number
    intents: number
    assignments: number
    active: number
    reports: number
    executions: number
    evidence: number
  }
}

const emptyFrontier = () => ({ ready: [], available: [], running: [], blocked: [], done: [] })

/** Board projection: what the commander reads at the top of every turn. */
export async function buildBoard(engine: PrismEngine, recovered: string[] = []): Promise<BoardView> {
  const present = await engine.exists()
  if (!present) {
    return {
      present: false,
      origin: '',
      goal: '',
      status: 'absent',
      schema_version: 0,
      frontier: emptyFrontier(),
      assignments: [],
      facts: [],
      recent_reports: [],
      pending_effects: 0,
      unknown_effects: 0,
      recovered,
      counts: { facts: 0, intents: 0, assignments: 0, active: 0, reports: 0, executions: 0, evidence: 0 }
    }
  }
  const project = await engine.store.loadProject()
  const intents = await engine.store.listIntents()
  const facts = await engine.store.listFacts()
  const frontier = classify(intents, facts)
  const byId = new Map(intents.map((i) => [i.id, i]))
  const toView = (list: { id: string }[]): IntentView[] =>
    list
      .map((entry) => byId.get(entry.id))
      .filter((i): i is NonNullable<typeof i> => i !== undefined)
      .map((i) => ({
        id: i.id,
        description: oneLine(i.description, 240),
        from: i.from,
        to: i.to,
        confirm: i.confirm,
        approved: i.approved,
        claimed_by: i.claimed_by,
        backend: i.backend
      }))
  const [assignments, reports, effects, executions, evidence] = await Promise.all([
    engine.listAssignments(),
    engine.listReports(),
    engine.listEffects(),
    engine.listExecutions(),
    engine.store.listEntities('evidence', EvidenceSchema)
  ])
  return {
    present: true,
    origin: project.origin,
    goal: project.goal,
    status: project.status,
    schema_version: project.schema_version ?? 0,
    frontier: {
      ready: toView(frontier.ready),
      available: toView(frontier.available),
      running: toView(frontier.running),
      blocked: toView(frontier.blocked),
      done: toView(frontier.done)
    },
    assignments: assignments.map((a) => ({
      id: a.id,
      intent_id: a.intent_id,
      mandate_id: a.mandate_id,
      status: a.status,
      backend: a.backend,
      attempts: a.attempts,
      worker_session: a.worker_session,
      resume_of: a.resume_of
    })),
    facts: facts
      .filter((f) => f.id !== 'goal')
      .map((f) => ({
        id: f.id,
        title: oneLine(f.title, 160),
        summary: oneLine(f.summary, 600),
        evidence: f.evidence,
        source_intent: f.source_intent
      })),
    recent_reports: reports.slice(-10).map((r) => ({
      id: r.id,
      assignment_id: r.assignment_id,
      kind: r.kind,
      text: oneLine(r.text, 600),
      facts: r.facts
    })),
    pending_effects: effects.filter((e) => e.status === 'pending').length,
    unknown_effects: effects.filter((e) => e.status === 'unknown').length,
    recovered,
    counts: {
      facts: facts.filter((f) => f.id !== 'goal').length,
      intents: intents.length,
      assignments: assignments.length,
      active: assignments.filter((a) => ['running', 'spawned', 'waiting'].includes(a.status)).length,
      reports: reports.length,
      executions: executions.length,
      evidence: evidence.length
    }
  }
}

export interface WorkersView {
  assignments: AssignmentView[]
  executions: {
    id: string
    assignment_id: string
    status: string
    output_cursor: number
    job_ref: string | null
    command: string
  }[]
}

/** Workers view: assignment history plus live execution handles. */
export async function buildWorkers(engine: PrismEngine): Promise<WorkersView> {
  if (!(await existsPath(engine.root))) return { assignments: [], executions: [] }
  const [assignments, executions] = await Promise.all([engine.listAssignments(), engine.listExecutions()])
  return {
    assignments: assignments.map((a) => ({
      id: a.id,
      intent_id: a.intent_id,
      mandate_id: a.mandate_id,
      status: a.status,
      backend: a.backend,
      attempts: a.attempts,
      worker_session: a.worker_session,
      resume_of: a.resume_of
    })),
    executions: executions.map((x) => ({
      id: x.id,
      assignment_id: x.assignment_id,
      status: x.status,
      output_cursor: x.output_cursor,
      job_ref: x.job_ref,
      command: oneLine(x.command ?? '', 160)
    }))
  }
}

export interface EvidenceView {
  items: { id: string; title: string; summary: string; path: string; bytes: number }[]
}

/** Evidence view: recorded evidence nodes only (never file contents). */
export async function buildEvidence(engine: PrismEngine): Promise<EvidenceView> {
  if (!(await existsPath(engine.root))) return { items: [] }
  const items = await engine.store.listEntities('evidence', EvidenceSchema)
  return {
    items: items.map((e) => ({
      id: e.id,
      title: oneLine(e.title, 160),
      summary: oneLine(e.summary, 400),
      path: e.path,
      bytes: e.bytes
    }))
  }
}

export interface ReportView2 {
  generated_at: string
  origin: string
  goal: string
  facts: number
  intents: { open: number; done: number }
  assignments: Record<string, number>
  reports: ReportView[]
  effects: Record<string, number>
}/** Engagement report: the numbers a human reads at the end of a run. */
export async function buildReport(engine: PrismEngine): Promise<ReportView2> {
  if (!(await existsPath(engine.root))) {
    return {
      generated_at: new Date().toISOString(),
      origin: '',
      goal: '',
      facts: 0,
      intents: { open: 0, done: 0 },
      assignments: {},
      reports: [],
      effects: {}
    }
  }
  const project = await engine.store.loadProject()
  const [intents, facts, assignments, reports, effects] = await Promise.all([
    engine.store.listIntents(),
    engine.store.listFacts(),
    engine.listAssignments(),
    engine.listReports(),
    engine.listEffects()
  ])
  const tally = (values: string[]) =>
    values.reduce<Record<string, number>>((acc, v) => {
      acc[v] = (acc[v] ?? 0) + 1
      return acc
    }, {})
  return {
    generated_at: new Date().toISOString(),
    origin: project.origin,
    goal: project.goal,
    facts: facts.filter((f) => f.id !== 'goal').length,
    intents: { open: intents.filter((i) => i.to === null).length, done: intents.filter((i) => i.to !== null).length },
    assignments: tally(assignments.map((a) => a.status)),
    reports: reports.map((r) => ({
      id: r.id,
      assignment_id: r.assignment_id,
      kind: r.kind,
      text: oneLine(r.text, 400),
      facts: r.facts
    })),
    effects: tally(effects.map((e) => e.status))
  }
}

export type GraphNodeKind = 'fact' | 'intent' | 'assignment'

export interface GraphNode {
  id: string
  kind: GraphNodeKind
  label: string
  /** Derived frontier state for intents, assignment status otherwise. */
  state: string
}

export interface GraphEdge {
  from: string
  to: string
  kind: 'from' | 'result' | 'claim'
}

export interface GraphView {
  present: boolean
  nodes: GraphNode[]
  edges: GraphEdge[]
  counts: { fact: number; intent: number; assignment: number }
  /** Live activity totals, shown alongside the DAG instead of as clutter nodes. */
  activity: { reports: number; executions: number; evidence: number }
}

/**
 * Graph view: the fact-intent reasoning DAG plus the assignments that claim its
 * intents. Live activity (reports, executions, evidence) is surfaced as counts,
 * not as one node per report: dumping 25 progress reports into the graph turned
 * it into a useless tall column (BUG-004).
 */
export async function buildGraph(engine: PrismEngine): Promise<GraphView> {
  const empty: GraphView = {
    present: false,
    nodes: [],
    edges: [],
    counts: { fact: 0, intent: 0, assignment: 0 },
    activity: { reports: 0, executions: 0, evidence: 0 }
  }
  if (!(await engine.exists())) return empty
  const [intents, facts, assignments, reports, executions, evidence] = await Promise.all([
    engine.store.listIntents(),
    engine.store.listFacts(),
    engine.listAssignments(),
    engine.listReports(),
    engine.listExecutions(),
    engine.store.listEntities('evidence', EvidenceSchema)
  ])
  const frontier = classify(intents, facts)
  const stateOf = new Map<string, string>()
  for (const [state, list] of Object.entries(frontier)) {
    for (const entry of list as { id: string }[]) stateOf.set(entry.id, state)
  }

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  for (const fact of facts) {
    nodes.push({ id: fact.id, kind: 'fact', label: oneLine(fact.title, 120), state: 'fact' })
  }
  for (const intent of intents) {
    nodes.push({
      id: intent.id,
      kind: 'intent',
      label: oneLine(intent.description, 120),
      state: stateOf.get(intent.id) ?? 'unknown'
    })
    for (const from of intent.from) edges.push({ from, to: intent.id, kind: 'from' })
    if (intent.to !== null) edges.push({ from: intent.id, to: intent.to, kind: 'result' })
  }
  for (const assignment of assignments) {
    // Label the worker node by its own id (a001…), not the shared intent id, so
    // four assignments of one intent do not look like a single node (BUG-004).
    nodes.push({ id: assignment.id, kind: 'assignment', label: assignment.id, state: assignment.status })
    edges.push({ from: assignment.intent_id, to: assignment.id, kind: 'claim' })
  }

  return {
    present: true,
    nodes,
    edges,
    counts: {
      fact: nodes.filter((n) => n.kind === 'fact').length,
      intent: nodes.filter((n) => n.kind === 'intent').length,
      assignment: nodes.filter((n) => n.kind === 'assignment').length
    },
    activity: { reports: reports.length, executions: executions.length, evidence: evidence.length }
  }
}
