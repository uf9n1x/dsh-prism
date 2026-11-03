// Worker row: mounted only inside the `prism-worker` agent preset.
//
// Publishes prism_worker_report plus the backend-mediated execution tools. It
// deliberately exposes none of the commander's control tools, mounts no
// ask-user tool, and cannot delegate further — the isolation is structural, not
// a matter of the worker's good behaviour.
import { workerTools, RuntimeFactory, type AgentContext } from './tools.js'
import { WORKER_PROTOCOL_SECTION } from '../protocol/sections.js'
import { kaliConfigOf } from './config.js'

export const name = 'prism-worker'
export const inject = ['tools', 'systemPrompt']

/** `config` is the row's YAML block; see src/host/config.ts for the shape. */
export function apply(ctx: AgentContext, config?: unknown): void {
  // A worker opens the same .prism/ as its commander. Reconciling from here would
  // mark every live assignment interrupted — including its own — so it never does.
  const factory = new RuntimeFactory(ctx, { kaliConfig: kaliConfigOf(config), reconcileOnOpen: false })
  for (const definition of workerTools(ctx, factory)) {
    ctx.tools.register(definition)
  }
  ctx.get('systemPrompt')?.section?.({
    name: 'prism:worker',
    order: 490,
    text: WORKER_PROTOCOL_SECTION
  })
  // A worker may never reach a control tool, whatever else gets mounted.
  ctx.tools.guard?.((exec: any) => {
    const toolName: unknown = exec?.toolName ?? exec?.tool?.name ?? exec?.name
    if (typeof toolName === 'string' && toolName.startsWith('prism_') && toolName !== 'prism_worker_report'
      && !toolName.startsWith('prism_exec') && toolName !== 'prism_run') {
      return `prism worker may not use control tool "${toolName}"`
    }
    return undefined
  })
}

export default { name, inject, apply }
