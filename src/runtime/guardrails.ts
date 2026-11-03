// Autonomous-loop guardrails.
//
// Prism has no scheduler and no timer; this module must never become one. The
// guardrail is a PURE decision (`assessGuardrails`) plus a tiny stateful tracker
// that is evaluated at an event boundary the loop already crosses (a worker turn
// ending), using an INJECTED clock. When it trips, the commander is not woken
// for another turn — it is restricted to the Watchdog's four operations.
//
// Three ways a loop runs away, each from the Super-agent "watchdog + dead-loop
// stop" design:
//   over-turns       — N automatic turns with no human message in between.
//   stalled          — an active assignment with neither a report nor output
//                      progress for the stall window.
//   repeated-blocked — the same assignment keeps reporting `blocked`.
import type { Assignment } from '../domain/assignment.js'
import type { Report } from '../domain/report.js'
import type { ExecutionRecord } from '../domain/execution.js'
import type { WatchdogOp } from './watchdog.js'

export interface GuardrailLimits {
  /** Max consecutive automatic commander turns with no human input. */
  maxAutoTurns: number
  /** No report and no output progress for this long is a stall. */
  stallMs: number
  /** Same intent reported `blocked` this many times in a row trips request-human. */
  maxBlockedRepeats: number
  /** After a trip, do not trip again for this long (prevents watchdog thrash). */
  cooldownMs: number
}

export const DEFAULT_GUARDRAIL_LIMITS: GuardrailLimits = {
  maxAutoTurns: 40,
  stallMs: 180_000,
  maxBlockedRepeats: 3,
  cooldownMs: 60_000
}

export interface GuardrailSnapshot {
  /** Automatic wakes since the last human message. */
  autoTurns: number
  /** ms since the most recent report for the active assignment, or null when none. */
  msSinceReport: number | null
  /** ms since that assignment's execution output cursor last moved, or null when no execution. */
  msSinceOutputProgress: number | null
  /** Trailing consecutive `blocked` reports for that assignment. */
  blockedRepeats: number
}

export interface GuardrailState {
  autoTurns: number
  lastHumanAt: number
  lastTripAt: number
}

export type GuardrailTrip =
  | { tripped: false }
  | {
      tripped: true
      op: WatchdogOp
      reason: 'over-turns' | 'stalled' | 'repeated-blocked'
      detail: string
    }

/**
 * Decide whether the autonomous loop should be stopped. Side-effect free and
 * deterministic for a given (snapshot, state, limits, now), so it is trivially
 * unit-testable with a fake clock.
 */
export function assessGuardrails(
  snapshot: GuardrailSnapshot,
  state: GuardrailState,
  limits: GuardrailLimits,
  now: number
): GuardrailTrip {
  // Cooldown gates every dimension: a loop that trips twice in quick succession
  // must not keep thrashing the watchdog.
  if (state.lastTripAt > 0 && now - state.lastTripAt < limits.cooldownMs) return { tripped: false }

  if (snapshot.autoTurns > limits.maxAutoTurns) {
    return {
      tripped: true,
      op: 'request-human',
      reason: 'over-turns',
      detail: `${String(snapshot.autoTurns)} automatic turns without a human message (limit ${String(limits.maxAutoTurns)})`
    }
  }

  const stalledOnReport = snapshot.msSinceReport !== null && snapshot.msSinceReport > limits.stallMs
  const stalledOnOutput = snapshot.msSinceOutputProgress === null || snapshot.msSinceOutputProgress > limits.stallMs
  if (stalledOnReport && stalledOnOutput) {
    return {
      tripped: true,
      op: 'pause',
      reason: 'stalled',
      detail: `no report or output progress for ${String(Math.round((snapshot.msSinceReport ?? 0) / 1000))}s`
    }
  }

  if (snapshot.blockedRepeats >= limits.maxBlockedRepeats) {
    return {
      tripped: true,
      op: 'request-human',
      reason: 'repeated-blocked',
      detail: `${String(snapshot.blockedRepeats)} consecutive blocked reports on one assignment`
    }
  }

  return { tripped: false }
}

/**
 * Stateful wrapper around `assessGuardrails`. Holds one state per scope key
 * (normally the commander session) and takes an injected clock so tests drive
 * time directly. It owns no timer.
 */
export class GuardrailTracker {
  private readonly state = new Map<string, GuardrailState>()

  constructor(
    private readonly limits: GuardrailLimits = DEFAULT_GUARDRAIL_LIMITS,
    private readonly clock: () => number = () => Date.now()
  ) {}

  private get(key: string): GuardrailState {
    const existing = this.state.get(key)
    if (existing !== undefined) return existing
    const fresh: GuardrailState = { autoTurns: 0, lastHumanAt: 0, lastTripAt: 0 }
    this.state.set(key, fresh)
    return fresh
  }

  /** A real human message clears the automatic-turn budget and any cooldown. */
  onHuman(key: string): void {
    this.state.set(key, { autoTurns: 0, lastHumanAt: this.clock(), lastTripAt: 0 })
  }

  /** Count one automatic commander turn (an autonomously triggered wake). */
  onAutoTurn(key: string): void {
    this.get(key).autoTurns += 1
  }

  /**
   * The commander did real work (dispatched new work). Clear the automatic-turn
   * budget but keep the cooldown/human timestamps: a loop that keeps producing
   * new assignments is making progress, not spinning.
   */
  onProgress(key: string): void {
    this.get(key).autoTurns = 0
  }

  /** Evaluate and, on a trip, arm the cooldown. */
  assess(key: string, snapshot: Omit<GuardrailSnapshot, 'autoTurns'>): GuardrailTrip {
    const state = this.get(key)
    const now = this.clock()
    const trip = assessGuardrails({ ...snapshot, autoTurns: state.autoTurns }, state, this.limits, now)
    if (trip.tripped) state.lastTripAt = now
    return trip
  }

  /** Drop a scope's state (tests / explicit reset). */
  reset(key: string): void {
    this.state.delete(key)
  }
}

/** Anything that can supply the read-only progress data a snapshot needs. */
export interface GuardrailProgressPort {
  listAssignments(): Promise<Assignment[]>
  listReports(): Promise<Report[]>
  listExecutions(): Promise<ExecutionRecord[]>
}

/** One module-level tracker per engagement root: state survives across events. */
const trackers = new Map<string, GuardrailTracker>()

export function guardrailTrackerFor(rootKey: string): GuardrailTracker {
  const existing = trackers.get(rootKey)
  if (existing !== undefined) return existing
  const created = new GuardrailTracker()
  trackers.set(rootKey, created)
  return created
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null
}

/**
 * Build the non-counter part of a snapshot for the assignment a worker session
 * belongs to. Missing assignment (already closed) yields nulls, which cannot
 * trip a stall on its own.
 */
export async function snapshotProgress(
  port: GuardrailProgressPort,
  workerSession: string | null,
  now: number
): Promise<Omit<GuardrailSnapshot, 'autoTurns'>> {
  const assignments = await port.listAssignments()
  const target = workerSession === null ? undefined : assignments.find((a) => a.worker_session === workerSession)
  if (target === undefined) return { msSinceReport: null, msSinceOutputProgress: null, blockedRepeats: 0 }

  const reports = (await port.listReports()).filter((r) => r.assignment_id === target.id)
  const lastReport = reports.at(-1)
  const msSinceReport = lastReport ? now - Date.parse(lastReport.created_at) : null

  const execs = (await port.listExecutions()).filter((e) => e.assignment_id === target.id)
  const lastExec = execs.at(-1)
  const msSinceOutputProgress = lastExec ? now - Date.parse(lastExec.updated_at ?? lastExec.created_at) : null

  let blockedRepeats = 0
  for (let i = reports.length - 1; i >= 0; i -= 1) {
    if (reports[i]!.kind === 'blocked') blockedRepeats += 1
    else break
  }

  return {
    msSinceReport: msSinceReport === null ? null : finiteOrNull(msSinceReport),
    msSinceOutputProgress: msSinceOutputProgress === null ? null : finiteOrNull(msSinceOutputProgress),
    blockedRepeats
  }
}
