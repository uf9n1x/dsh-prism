// Restart reconciliation. A process exit is not a domain event: it leaves live
// assignments stranded and effects with an unobserved outcome. Recovery is
// deliberately conservative — interrupted work is resumable, an unknown side
// effect is quarantined for review, and nothing is silently replayed.
import type { PrismEngine } from '../engine/engine.js'
import type { Effect } from '../domain/index.js'

export interface RecoveryReport {
  schema_version: number
  interrupted: string[]
  resumable: { assignment_id: string; intent_id: string }[]
  unknown_effects: Effect[]
  pending_effects: string[]
  review_required: boolean
}

/**
 * Bring `.prism/` back to a coherent state.
 *
 * - `running`/`spawned`/`waiting`/`ready` assignments cannot survive the exit:
 *   they become `interrupted` and stay resumable.
 * - `unknown` effects are surfaced for review and never dispatched.
 * - `pending` effects stay for the outbox, which only runs after a commit.
 */
export async function reconcile(engine: PrismEngine): Promise<RecoveryReport> {
  const schemaVersion = await engine.open()
  const interrupted = await engine.recoverAssignments()
  const assignments = await engine.listAssignments()
  const resumable = assignments
    .filter((a) => a.status === 'interrupted')
    .map((a) => ({ assignment_id: a.id, intent_id: a.intent_id }))
  const effects = await engine.listEffects()
  const unknown = effects.filter((e) => e.status === 'unknown')
  return {
    schema_version: schemaVersion,
    interrupted,
    resumable,
    unknown_effects: unknown,
    pending_effects: effects.filter((e) => e.status === 'pending').map((e) => e.id),
    review_required: unknown.length > 0
  }
}

/** One-line summary for a tool result or a log line. */
export function describeRecovery(report: RecoveryReport): string {
  const parts = [`schema v${String(report.schema_version)}`]
  if (report.interrupted.length > 0) parts.push(`${String(report.interrupted.length)} interrupted`)
  if (report.resumable.length > 0) parts.push(`${String(report.resumable.length)} resumable`)
  if (report.pending_effects.length > 0) parts.push(`${String(report.pending_effects.length)} pending effects`)
  if (report.unknown_effects.length > 0) parts.push(`${String(report.unknown_effects.length)} unknown effects need review`)
  return parts.join(', ')
}
