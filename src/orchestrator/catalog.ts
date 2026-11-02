// Tool catalog declarations + isolation invariants.
// The commander (decision agent) must NEVER expose execution tools; workers own
// them. These constants are the single source used by presets, the dynamic scope
// reconciler and the structural tests.

export const COMMANDER_TOOL_NAMES = [
  'prism_board',
  'prism_reason',
  'prism_hint',
  'prism_spawn',
  'prism_peek',
  'prism_msg',
  'prism_kill',
  'prism_verify',
  'prism_capabilities'
] as const

export const WORKER_EXEC_TOOLS = ['prism_run', 'prism_read', 'prism_write', 'prism_http'] as const

export const WORKER_TOOL_NAMES = ['prism_worker_report', ...WORKER_EXEC_TOOLS] as const

// Native DSH execution tools that must never reach the commander.
const NATIVE_EXEC_TOOLS = new Set([
  'bash',
  'pwsh',
  'powershell',
  'cmd',
  'shell',
  'terminal',
  'read',
  'write',
  'edit',
  'apply_patch',
  'glob',
  'grep',
  'web_fetch',
  'web_search',
  'run_code'
])

const EXEC_TOOL_SET = new Set<string>([...NATIVE_EXEC_TOOLS, ...WORKER_EXEC_TOOLS])

export function isExecutionTool(name: string): boolean {
  if (EXEC_TOOL_SET.has(name)) return true
  if (name.startsWith('mcp__')) return true // any MCP tool is treated as executable capability
  return false
}

export function isControlTool(name: string): boolean {
  return (COMMANDER_TOOL_NAMES as readonly string[]).includes(name)
}

export function assertCommanderClean(names: readonly string[]): void {
  const leaked = names.filter(isExecutionTool)
  if (leaked.length > 0) {
    throw new Error(`commander must not expose execution tools: ${leaked.join(', ')}`)
  }
}

export function assertWorkerCapable(names: readonly string[]): void {
  const missing = WORKER_EXEC_TOOLS.filter((t) => !names.includes(t))
  if (missing.length > 0) {
    throw new Error(`worker missing exec tools: ${missing.join(', ')}`)
  }
  const leakedControl = names.filter(isControlTool)
  if (leakedControl.length > 0) {
    throw new Error(`worker must not expose control tools: ${leakedControl.join(', ')}`)
  }
}
