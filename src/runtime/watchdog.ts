// Restricted Watchdog. It may observe `.prism/` and do exactly four things:
// pause, interrupt, request a human, or write its own report. It cannot edit a
// mandate, a prompt, a tool policy or an engagement scope — there is no code
// path here that could, which is the point. Its authority is a closed union, so
// a new capability requires a new ADR rather than a config flag.
//
// It is deliberately handed a NARROW port (`WatchdogPort`) rather than the whole
// engine: the type system, not just convention, is what stops a future edit from
// reaching mandate/prompt/tool authority from inside the watchdog.
import type { Assignment } from '../domain/assignment.js'
import type { Report } from '../domain/report.js'
import type { Effect } from '../domain/effect.js'
import type { ExecutionRecord } from '../domain/execution.js'

export const WATCHDOG_OPS = ['pause', 'interrupt', 'request-human', 'write-watchdog-report'] as const
export type WatchdogOp = (typeof WATCHDOG_OPS)[number]

/**
 * The only capabilities the watchdog is given. It can observe, pause, and record
 * — never mint authority, edit a prompt, register a tool, or widen a scope.
 */
export interface WatchdogPort {
  listAssignments(): Promise<Assignment[]>
  listReports(): Promise<Report[]>
  listEffects(): Promise<Effect[]>
  listExecutions(): Promise<ExecutionRecord[]>
  setAssignmentStatus(id: string, status: 'paused'): Promise<unknown>
  importEntity(dirName: string, id: string, value: unknown): Promise<void>
}

// --- compile-time authority barrier -------------------------------------
// If anyone adds an authority-changing method to WatchdogPort, these two lines
// stop compiling (tsc checks src/). Kept here rather than in a test so it is a
// real gate: the watchdog cannot gain mandate/prompt/tool power by accident.
type AuthorityWrite = 'createMandate' | 'widenMandate' | 'setPrompt' | 'registerTool' | 'grantMandate'
type _WatchdogPortHasNoAuthorityWrite = Extract<keyof WatchdogPort, AuthorityWrite> extends never ? true : never
const WATCHDOG_PORT_IS_NARROW: _WatchdogPortHasNoAuthorityWrite = true
void WATCHDOG_PORT_IS_NARROW

export interface WatchdogFinding {
  assignment_id: string
  reason: 'stalled' | 'over-budget' | 'unknown-effect' | 'no-progress'
  detail: string
}

export interface WatchdogReport {
  wrote_at: string
  findings: WatchdogFinding[]
  actions: { op: WatchdogOp; assignment_id?: string; detail: string }[]
}

export interface WatchdogLimits {
  /** An active assignment with no report and no output progress inside this window is stalled. */
  stallMs: number
  /** Maximum concurrent live assignments before the watchdog intervenes. */
  maxActive: number
  now?: number
}

const ACTIVE_STATUSES = ['spawned', 'running', 'waiting', 'ready'] as const

/** Last time anything moved on this assignment: a report, or an execution cursor tick. */
function lastProgressAt(
  assignment: Assignment,
  report: Report | undefined,
  executions: ExecutionRecord[]
): number {
  const candidates: number[] = [Date.parse(assignment.updated_at ?? assignment.created_at)]
  if (report !== undefined) candidates.push(Date.parse(report.created_at))
  for (const exec of executions) candidates.push(Date.parse(exec.updated_at ?? exec.created_at))
  return Math.max(...candidates.filter((n) => Number.isFinite(n)))
}

export class Watchdog {
  private readonly port: WatchdogPort
  private readonly limits: WatchdogLimits

  constructor(port: WatchdogPort, limits: WatchdogLimits) {
    this.port = port
    this.limits = limits
  }

  /** Read-only scan; produces findings without any side effect. */
  async scan(): Promise<WatchdogFinding[]> {
    const now = this.limits.now ?? Date.now()
    const findings: WatchdogFinding[] = []
    const assignments = await this.port.listAssignments()
    const reports = await this.port.listReports()
    const executions = await this.port.listExecutions()
    const active = assignments.filter((a) => (ACTIVE_STATUSES as readonly string[]).includes(a.status))
    for (const a of active) {
      const mine = reports.filter((r) => r.assignment_id === a.id)
      const last = mine.at(-1)
      const progressedAt = lastProgressAt(a, last, executions.filter((e) => e.assignment_id === a.id))
      const age = now - Date.parse(a.created_at)
      // A worker's output ticking forward is progress even without a report: do
      // not pause a long scan that is still streaming.
      if (Number.isFinite(progressedAt) && now - progressedAt > this.limits.stallMs) {
        findings.push({
          assignment_id: a.id,
          reason: 'stalled',
          detail: `no report or output progress for ${String(Math.round((now - progressedAt) / 1000))}s`
        })
      } else if (!last && Number.isFinite(age) && age >= this.limits.stallMs) {
        // Only after the grace window: a freshly spawned assignment that has not
        // reported yet is normal, not "no progress". This used to fire at once and
        // would have paused every new worker the moment the watchdog was wired in.
        findings.push({ assignment_id: a.id, reason: 'no-progress', detail: 'assignment started without a report' })
      }
    }
    if (active.length > this.limits.maxActive) {
      for (const a of active.slice(this.limits.maxActive)) {
        findings.push({
          assignment_id: a.id,
          reason: 'over-budget',
          detail: `${String(active.length)} live assignments (limit ${String(this.limits.maxActive)})`
        })
      }
    }
    for (const effect of await this.port.listEffects()) {
      if (effect.status === 'unknown') {
        findings.push({
          assignment_id: effect.refs[0] ?? 'unknown',
          reason: 'unknown-effect',
          detail: `effect ${effect.id} (${effect.kind}) has an unobserved outcome`
        })
      }
    }
    return findings
  }

  /**
   * Act on findings using only the allowed operations. `pause` moves an
   * assignment to `paused` (recoverable), `interrupt` asks the host to stop the
   * live child, and `request-human` raises a durable marker.
   */
  async act(
    findings: WatchdogFinding[],
    interrupt: (assignmentId: string) => Promise<boolean>
  ): Promise<WatchdogReport> {
    const actions: WatchdogReport['actions'] = []
    for (const finding of findings) {
      if (finding.reason === 'stalled' || finding.reason === 'over-budget') {
        actions.push(await this.pause(finding.assignment_id, finding.detail))
        const stopped = await interrupt(finding.assignment_id).catch(() => false)
        if (stopped) {
          actions.push({ op: 'interrupt', assignment_id: finding.assignment_id, detail: 'hosted child interrupted' })
        }
      } else if (finding.reason === 'unknown-effect') {
        actions.push(await this.requestHuman(finding.detail))
      } else {
        actions.push(await this.writeReport(finding.assignment_id, finding.detail))
      }
    }
    return { wrote_at: new Date().toISOString(), findings, actions }
  }

  /** Execute exactly one allowed op. The only entry point the guardrail uses. */
  async applyOp(op: WatchdogOp, detail: string, assignmentId?: string): Promise<WatchdogReport['actions'][number]> {
    switch (op) {
      case 'pause':
        return this.pause(assignmentId, detail)
      case 'request-human':
        return this.requestHuman(detail)
      case 'write-watchdog-report':
        return this.writeReport(assignmentId, detail)
      case 'interrupt':
        // The real interrupt is host-side (there is no host handle in the port);
        // the caller performs it and records the action it actually fired.
        return { op, assignment_id: assignmentId, detail }
    }
  }

  private async pause(assignmentId: string | undefined, detail: string): Promise<WatchdogReport['actions'][number]> {
    if (assignmentId !== undefined) await this.port.setAssignmentStatus(assignmentId, 'paused').catch(() => null)
    return { op: 'pause', assignment_id: assignmentId, detail }
  }

  private async requestHuman(detail: string): Promise<WatchdogReport['actions'][number]> {
    await this.port
      .importEntity('watchdog', `human-${Date.now().toString(36)}`, { kind: 'request-human', detail, wrote_at: new Date().toISOString() })
      .catch(() => undefined)
    return { op: 'request-human', detail }
  }

  private async writeReport(assignmentId: string | undefined, detail: string): Promise<WatchdogReport['actions'][number]> {
    return { op: 'write-watchdog-report', assignment_id: assignmentId, detail }
  }

  /** Persist the watchdog's own report as an effect-free domain-adjacent note. */
  async persist(report: WatchdogReport): Promise<void> {
    await this.port.importEntity('watchdog', `w${Date.now().toString(36)}`, report)
  }
}

/** Whether an operation name is inside the watchdog's authority. */
export function isWatchdogOp(op: string): op is WatchdogOp {
  return (WATCHDOG_OPS as readonly string[]).includes(op)
}
