import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismRuntime, rootFor, denyAllApprovals, type NativeOps } from '../../src/host/runtime'
import { classifyCommand } from '../../src/exec/backend'

let dir: string
let runtime: PrismRuntime
const ops: NativeOps = {
  spawn: async () => ({ sessionId: 'sess-w' }),
  send: async () => undefined,
  interrupt: async () => undefined
}

/**
 * These cases are about the gate itself, so they run in the interactive mode
 * (`preAuthorized: false`). The standing-authorization behaviour is asserted
 * separately below, so neither mode is left untested.
 */
async function fresh(
  options: {
    approval?: { request: (i: any) => Promise<{ approved: boolean; detail?: string }> }
    preAuthorized?: boolean
  } = {}
) {
  runtime = new PrismRuntime({
    root: rootFor(dir),
    cwd: dir,
    approval: options.approval,
    preAuthorized: options.preAuthorized ?? false
  })
  await runtime.init('acme', 'g', 'SOE-1')
}

async function assignment(actions: string[], strength: 'read' | 'exploit' = 'read') {
  const mandate = await runtime.engine.createMandate({
    policy_version: 'v1',
    scope: { targets: ['10.0.0.5'], actions, backends: ['local'] },
    strength,
    source: 'user',
    basis: 'SOE-1'
  })
  const [intent] = await runtime.reason([{ description: 'work', from: ['goal'] }])
  const dispatched = await runtime.dispatch({ intent_id: intent!.id, mandate_id: mandate.id, brief: 'do it' }, ops)
  return dispatched.assignment.id
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prism-exec-'))
})
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 250))
  await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 })
})

describe('P6 local execution policy', () => {
  it('classifies commands deterministically and defaults unknown to confirm', () => {
    expect(classifyCommand('nmap -sV 10.0.0.5').action).toBe('scan')
    expect(classifyCommand('nmap -sV 10.0.0.5').requires_confirm).toBe(false)
    expect(classifyCommand('curl http://10.0.0.5/').action).toBe('fetch')
    expect(classifyCommand('sqlmap -u http://10.0.0.5').requires_confirm).toBe(true)
    expect(classifyCommand('some-unknown-binary --flag').action).toBe('unknown')
    expect(classifyCommand('some-unknown-binary --flag').requires_confirm).toBe(true)
  })

  it('refuses an action outside the mandate before any process starts', async () => {
    await fresh()
    const id = await assignment(['scan'])
    await expect(runtime.execStart({ assignment_id: id, command: 'hydra -l root 10.0.0.5' })).rejects.toThrow(
      /authorization denied/i
    )
    expect(await runtime.engine.listExecutions()).toHaveLength(0)
  })

  it('requires host approval for a write-class command and refuses when no channel exists', async () => {
    await fresh()
    const id = await assignment(['run', 'write'])
    await expect(runtime.execStart({ assignment_id: id, command: 'echo hi > out.txt' })).rejects.toThrow(
      /confirmation required/i
    )
  })

  it('runs a read command asynchronously, then reports its exit status', async () => {
    await fresh()
    const id = await assignment(['read'])
    const started = await runtime.execStart({ assignment_id: id, command: 'echo prism-exec-ok' })
    expect(started.execution_id).toBe('x001')
    expect(started.classification.action).toBe('read')

    let out = await runtime.execOutput(started.execution_id)
    for (let i = 0; i < 40 && out.status === 'running'; i += 1) {
      await new Promise((r) => setTimeout(r, 50))
      out = await runtime.execOutput(started.execution_id)
    }
    expect(out.chunk).toContain('prism-exec-ok')
    expect(out.status).toBe('done')
    expect(out.exit_code).toBe(0)
    expect(out.cursor).toBeGreaterThan(0)
  })

  it('stop terminates a long-running execution and records it as stopped', async () => {
    await fresh()
    const id = await assignment(['run'])
    const started = await runtime.execStart({
      assignment_id: id,
      command: 'ping -n 30 127.0.0.1'
    })
    const stopped = await runtime.execStop(started.execution_id)
    expect(stopped.status).toBe('stopped')
    await new Promise((r) => setTimeout(r, 300))
    const after = await runtime.execOutput(started.execution_id)
    expect(after.status === 'stopped' || after.status === 'failed' || after.status === 'done').toBe(true)
  })

  it('redacts credential-shaped output before it reaches a tool result', async () => {
    await fresh()
    const id = await assignment(['run', 'read'])
    const started = await runtime.execStart({
      assignment_id: id,
      command: 'echo "token=abcdef123456"'
    })
    let out = await runtime.execOutput(started.execution_id)
    for (let i = 0; i < 40 && !out.chunk.includes('token'); i += 1) {
      await new Promise((r) => setTimeout(r, 50))
      out = await runtime.execOutput(started.execution_id)
    }
    expect(out.chunk).not.toContain('abcdef123456')
    expect(out.chunk).toContain('[redacted]')
  })

  it('denyAllApprovals is the fail-closed default', async () => {
    await expect(denyAllApprovals.request({ assignmentId: 'a1', action: 'write', summary: 'x' })).resolves.toMatchObject({
      approved: false
    })
  })

  it('an explicit host approval lets a write-class command proceed', async () => {
    await fresh({ approval: { request: async () => ({ approved: true }) } })
    const id = await assignment(['run', 'write'])
    const started = await runtime.execStart({ assignment_id: id, command: 'echo ok > prism-approved.txt' })
    expect(started.execution_id).toBeTruthy()
    expect(started.confirmed_by).toBe('host')
    let out = await runtime.execOutput(started.execution_id)
    for (let i = 0; i < 40 && out.status === 'running'; i += 1) {
      await new Promise((r) => setTimeout(r, 50))
      out = await runtime.execOutput(started.execution_id)
    }
    expect(out.status).toBe('done')
  })

  it('standing authorization runs a confirm-class command without asking, and says so in the result', async () => {
    let asked = 0
    await fresh({
      preAuthorized: true,
      approval: {
        request: async () => {
          asked += 1
          throw new Error('standing authorization must not reach the approval channel')
        }
      }
    })
    const id = await assignment(['run', 'write'])
    const started = await runtime.execStart({ assignment_id: id, command: 'echo ok > prism-standing.txt' })
    expect(asked).toBe(0)
    expect(started.confirmed_by).toBe('standing')
    let out = await runtime.execOutput(started.execution_id)
    for (let i = 0; i < 40 && out.status === 'running'; i += 1) {
      await new Promise((r) => setTimeout(r, 50))
      out = await runtime.execOutput(started.execution_id)
    }
    expect(out.status).toBe('done')
    expect(out.exit_code).toBe(0)
  })

  it('standing authorization still refuses an action outside the mandate', async () => {
    // Removing the prompt must not remove the scope check: this is the line that
    // separates "pre-authorized" from "anything goes".
    await fresh({ preAuthorized: true })
    const id = await assignment(['scan'])
    await expect(runtime.execStart({ assignment_id: id, command: 'echo x > prism-out.txt' })).rejects.toThrow(
      /authorization denied/i
    )
  })
})
