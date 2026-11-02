import { describe, it, expect } from 'vitest'
import {
  COMMANDER_TOOL_NAMES,
  WORKER_TOOL_NAMES,
  WORKER_EXEC_TOOLS,
  isExecutionTool,
  isControlTool,
  assertCommanderClean,
  assertWorkerCapable
} from '../../src/orchestrator/catalog'
import { computeCommanderRestriction } from '../../src/orchestrator/reconcile'

describe('P2 commander/worker structural isolation', () => {
  it('no commander tool is an execution tool', () => {
    for (const name of COMMANDER_TOOL_NAMES) {
      expect(isExecutionTool(name), `${name} must not be executable`).toBe(false)
    }
  })

  it('commander and worker tool sets are disjoint', () => {
    const overlap = COMMANDER_TOOL_NAMES.filter((n) => WORKER_TOOL_NAMES.includes(n))
    expect(overlap).toEqual([])
  })

  it('worker owns the execution tools and none of the control tools', () => {
    for (const t of WORKER_EXEC_TOOLS) expect(WORKER_TOOL_NAMES).toContain(t)
    for (const n of WORKER_TOOL_NAMES) expect(isControlTool(n)).toBe(false)
  })

  it('assertCommanderClean accepts the commander set but rejects a leaked shell tool', () => {
    expect(() => assertCommanderClean(COMMANDER_TOOL_NAMES)).not.toThrow()
    expect(() => assertCommanderClean([...COMMANDER_TOOL_NAMES, 'bash'])).toThrow(/execution/i)
    expect(() => assertCommanderClean([...COMMANDER_TOOL_NAMES, 'mcp__kali__run'])).toThrow(
      /execution/i
    )
  })

  it('assertWorkerCapable requires exec tools and rejects control tools', () => {
    expect(() => assertWorkerCapable(WORKER_TOOL_NAMES)).not.toThrow()
    expect(() => assertWorkerCapable(WORKER_TOOL_NAMES.filter((n) => n !== 'prism_run'))).toThrow(
      /exec/i
    )
    expect(() => assertWorkerCapable([...WORKER_TOOL_NAMES, 'prism_spawn'])).toThrow(/control/i)
  })

  it('dynamic restriction strips execution tools (incl. newly mounted mcp__) from commander', () => {
    const visible = ['prism_board', 'prism_spawn', 'read', 'write', 'bash', 'mcp__kali__run', 'prism_run']
    const filter = computeCommanderRestriction(visible)
    expect(filter.deny).toEqual(expect.arrayContaining(['read', 'write', 'bash', 'mcp__kali__run', 'prism_run']))
    expect(filter.deny).not.toContain('prism_board')
    expect(filter.deny).not.toContain('prism_spawn')
  })
})
