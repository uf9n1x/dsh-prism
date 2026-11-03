// Prism bundle entry — the GLOBAL host row.
//
// It owns nothing agent-facing: no tools, no prompt sections. Its single job is
// to turn a finished worker into a persisted event and, only when the fast path
// says the commander actually needs to think, wake it. All domain state lives in
// `.prism/`; this row never caches an engagement.
import { PrismRuntime, rootFor } from './host/runtime.js'
import { wakeNudge } from './runtime/fastpath.js'

export const name = 'dsh-prism'
export const inject: string[] = []

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
        await wake(commanderSession, wakeNudge(1))
      } catch (err) {
        ctx.logger?.warn?.(`prism: subagent/end handling failed: ${(err as Error).message}`)
      }
    })()
  })
}

export default { name, inject, apply }
