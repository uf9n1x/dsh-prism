// Prism bundle entry — the GLOBAL host row.
//
// It owns nothing agent-facing: no tools, no prompt sections. Its single job is
// to turn a finished worker into a persisted event and, only when the fast path
// says the commander actually needs to think, wake it. All domain state lives in
// `.prism/`; this row never caches an engagement.
import { PrismRuntime, rootFor } from './host/runtime.js'
import { wakeNudge } from './runtime/fastpath.js'
import { guardrailTrackerFor, snapshotProgress, type GuardrailTrip } from './runtime/guardrails.js'

export const name = 'dsh-prism'
export const inject: string[] = []

/** Assignment count seen at the previous event, per engagement root (progress signal). */
const lastAssignmentCount = new Map<string, number>()

/** Read the working directory of an agent without assuming the service exists. */
function cwdOfAgent(ctx: any, agent: any): string {
  try {
    const wd = ctx.get?.('workingDirectory')
    if (wd !== undefined && agent?.session !== undefined) {
      const dir = wd.get(agent.session)
      if (typeof dir === 'string' && dir.length > 0) return dir
    }
  } catch {
    // fall through
  }
  return process.cwd()
}

/** Extract plain text from the assistant message blocks a subagent end carries. */
function textOf(message: any): string {
  if (message === undefined || message === null) return ''
  if (typeof message === 'string') return message
  if (Array.isArray(message)) {
    return message
      .map((block: any) => (typeof block?.text === 'string' ? block.text : ''))
      .filter((t: string) => t.length > 0)
      .join('\n')
  }
  return ''
}

/**
 * Stop a runaway autonomous loop using only the watchdog's four operations.
 * The commander is not woken; a durable watchdog report records why.
 */
async function applyGuardrailTrip(
  runtime: PrismRuntime,
  ctx: any,
  parent: any,
  childId: string,
  trip: Extract<GuardrailTrip, { tripped: true }>
): Promise<void> {
  const dog = runtime.watchdog()
  const assignments = await runtime.engine.listAssignments()
  const target = assignments.find((a) => a.worker_session === childId)
  const assignmentId = target?.id
  const actions = [await dog.applyOp(trip.op, trip.detail, assignmentId)]
  if (trip.op === 'pause' && assignmentId !== undefined) {
    const subagents = ctx.get?.('subagents')
    if (subagents !== undefined && typeof subagents.interrupt === 'function' && target?.worker_session) {
      try {
        await subagents.interrupt(target.worker_session, { kind: 'ancestor', agent: parent })
        actions.push({ op: 'interrupt', assignment_id: assignmentId, detail: 'guardrail paused the assignment' })
      } catch {
        // best effort: the pause above already stops further automatic turns
      }
    }
  }
  await dog.persist({ wrote_at: new Date().toISOString(), findings: [], actions })
  ctx.logger?.warn?.(`prism guardrail tripped (${trip.reason}): ${trip.detail}`)
}

export function apply(ctx: any): void {
  const wake = async (sessionId: string, text: string): Promise<void> => {
    const controller = ctx.get?.('sessionController')
    if (controller === undefined || typeof controller.resolveAgent !== 'function') return
    const resolved = await controller.resolveAgent(sessionId)
    if (resolved === undefined || resolved?.error !== undefined) return
    const agent = resolved.agent
    if (agent === undefined) return
    agent.followup({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
    await ctx.get?.('sessions')?.flush?.(agent.session)
  }

  ctx.on?.('subagent/end', (payload: any, parent: any) => {
    // Never let a listener throw into the subagent lifecycle.
    void (async () => {
      try {
        const childId: string = String(payload?.id ?? 'unknown-child')
        const stopReason: string = String(payload?.stopReason ?? 'unknown')
        const cwd = cwdOfAgent(ctx, parent)
        const commanderSession: string | undefined = parent?.session?.id
        const runtime = new PrismRuntime({
          root: rootFor(cwd),
          cwd,
          wake: { wakeCommander: wake },
          commanderSession
        })
        if (!(await runtime.exists())) return
        await runtime.ensure()
        const decision = await runtime.eventRuntime.accept({
          source: 'subagent/end',
          dedupeKey: `${childId}:${stopReason}`,
          ownerSession: childId,
          commanderSession,
          body: textOf(payload?.lastAssistantMessage) || `stop:${stopReason}`
        })
        if (decision.kind !== 'wake') return
        if (commanderSession === undefined) return

        // Guardrail judgement point: the event is already durably persisted above
        // (accept writes the EventRecord) and the commander has NOT been woken
        // yet. This is the only place the autonomous loop crosses, so it is where
        // a runaway is stopped — by restricting the watchdog to its four ops
        // instead of handing the commander another turn. There is no timer here.
        const tracker = guardrailTrackerFor(cwd)
        const assignmentCount = (await runtime.engine.listAssignments()).length
        const previous = lastAssignmentCount.get(cwd) ?? -1
        // New assignment since the last event = the commander did real work, so
        // the automatic-turn budget resets. A loop that keeps waking without
        // producing anything is what accumulates and eventually trips.
        if (assignmentCount > previous) tracker.onProgress(cwd)
        lastAssignmentCount.set(cwd, assignmentCount)
        tracker.onAutoTurn(cwd)
        const progress = await snapshotProgress(runtime.engine, childId, Date.now())
        const trip = tracker.assess(cwd, progress)
        if (trip.tripped) {
          await applyGuardrailTrip(runtime, ctx, parent, childId, trip)
          return
        }

        await wake(commanderSession, wakeNudge(1))
      } catch (err) {
        ctx.logger?.warn?.(`prism: subagent/end handling failed: ${(err as Error).message}`)
      }
    })()
  })
}

export default { name, inject, apply }
