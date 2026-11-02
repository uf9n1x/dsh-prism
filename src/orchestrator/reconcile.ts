// Commander scope reconciliation (defense-in-depth, D7 / R6).
// Even though the commander preset mounts no execution rows, dynamically mounted
// capabilities (e.g. a new MCP server) register host-global tools. On every
// tools/change we recompute a deny filter that strips execution tools from the
// commander scope, so a mid-task capability never leaks into the decision agent.
import { isExecutionTool } from './catalog'

export interface ToolRestrictionPlan {
  deny: string[]
}

export function computeCommanderRestriction(visibleNames: readonly string[]): ToolRestrictionPlan {
  const deny = Array.from(new Set(visibleNames.filter(isExecutionTool)))
  return { deny }
}
