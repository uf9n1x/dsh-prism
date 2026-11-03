// Restricted Watchdog. It may observe `.prism/` and do exactly four things:
// pause, interrupt, request a human, or write its own report. It cannot edit a
// mandate, a prompt, a tool policy or an engagement scope — there is no code
// path here that could, which is the point. Its authority is a closed union, so
// a new capability requires a new ADR rather than a config flag.
import type { PrismEngine } from '../engine/engine.js'

export const WATCHDOG_OPS = ['pause', 'interrupt', 'request-human', 'write-watchdog-report'] as const
export type WatchdogOp = (typeof WATCHDOG_OPS)[number]

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
  /** An active assignment with no report inside this window is stalled. */
  stallMs: number
  /** Maximum concurrent live assignments before the watchdog intervenes. */
  maxActive: number
  now?: number
}

export class Watchdog {
  private readonly engine: PrismEngine
  private readonly limits: WatchdogLimits

  constructor(engine: PrismEngine, limits: WatchdogLimits) {
    this.engine = engine
    this.limits = limits
  }

  /** Read-only scan; produces findings without any side effect. */
  async scan(): Promise<WatchdogFinding[]> {
    const now = this.limits.now ?? Date.now()
    const findings: WatchdogFinding[] = []
    const assignments = await this.engine.listAssignments()
    const reports = await this.engine.listReports()
    const active = assignments.filter((a) => ['spawned', 'running', 'waiting', 'ready'].includes(a.status))
    for (const a of active) {
      const last = reports.filter((r) => r.assignment_id === a.id).at(-1)
      const lastAt = Date.parse(last?.created_at ?? a.updated_at ?? a.created_at)
      if (Number.isFinite(lastAt) && now - lastAt > this.limits.stallMs) {
        findings.push({ assignment_id: a.id, reason: 'stalled', detail: `no report for ${String(Math.round((now - lastAt) / 1000))}s` })
      }
      if (!last) {
        findings.push({ assignment_id: a.id, reason: 'no-progress', detail: 'assignment started without a report' })
      }
    }
    if (active.length > this.limits.maxActive) {
      for (const a of active.slice(this.limits.maxActive)) {
        findings.push({ assignment_id: a.id, reason: 'over-budget', detail: `${String(active.length)} live assignments (limit ${String(this.limits.maxActive)})` })
      }
    }
    for (const effect of await this.engine.listEffects()) {
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
  async act(findings: WatchdogFinding[], interrupt: (assignmentId: string) => Promise<boolean>): Promise<WatchdogReport> {
    const actions: WatchdogReport['actions'] = []
    for (const finding of findings) {
      if (finding.reason === 'stalled' || finding.reason === 'over-budget') {
        await this.engine.setAssignmentStatus(finding.assignment_id, 'paused').catch(() => null)
        actions.push({ op: 'pause', assignment_id: finding.assignment_id, detail: finding.detail })
        const stopped = await interrupt(finding.assignment_id).catch(() => false)
        if (stopped) actions.push({ op: 'interrupt', assignment_id: finding.assignment_id, detail: 'hosted child interrupted' })
      } else if (finding.reason === 'unknown-effect') {
        actions.push({ op: 'request-human', detail: finding.detail })
      } else {
        actions.push({ op: 'write-watchdog-report', assignment_id: finding.assignment_id, detail: finding.detail })
      }
    }
    return { wrote_at: new Date().toISOString(), findings, actions }
  }

  /** Persist the watchdog's own report as an effect-free domain-adjacent note. */
  async persist(report: WatchdogReport): Promise<void> {
    await this.engine.importEntity('watchdog', `w${Date.now().toString(36)}`, report)
  }
}

/** Whether an operation name is inside the watchdog's authority. */
export function isWatchdogOp(op: string): op is WatchdogOp {
  return (WATCHDOG_OPS as readonly string[]).includes(op)
}
