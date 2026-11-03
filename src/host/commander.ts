// Commander row: mounted only inside the `prism` agent preset.
//
// It publishes the control tool surface and the commander doctrine section, and
// installs a scope guard as defence in depth: even if a capability is mounted
// dynamically (an MCP server appearing mid-session), a call to any execution
// tool from this agent is denied at execution time.
import { commanderTools, RuntimeFactory, type AgentContext } from './tools.js'
import { COMMANDER_PROTOCOL_SECTION } from '../protocol/sections.js'
import { isExecutionTool } from '../orchestrator/catalog.js'

export const name = 'prism-commander'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx: AgentContext): void {
  const factory = new RuntimeFactory(ctx)
  for (const definition of commanderTools(ctx, factory)) {
    ctx.tools.register(definition)
  }
  ctx.get('systemPrompt')?.section?.({
    name: 'prism:commander',
    order: 480,
    text: COMMANDER_PROTOCOL_SECTION
  })
  ctx.tools.guard?.((exec: any) => {
    const toolName: unknown = exec?.toolName ?? exec?.tool?.name ?? exec?.name
    if (typeof toolName === 'string' && isExecutionTool(toolName)) {
      return `prism commander may not execute tools; "${toolName}" is a worker capability`
    }
    return undefined
  })
}

export default { name, inject, apply }
