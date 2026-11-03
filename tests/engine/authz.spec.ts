import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismEngine } from '../../src/engine/engine'

let dir: string
let root: string
let engine: PrismEngine

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prism-authz-'))
  root = join(dir, '.prism')
  engine = new PrismEngine(root)
  await engine.init('acme', 'g')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function setup(strength: 'read' | 'confirm' | 'write' | 'exploit', actions: string[]) {
  const intent = await engine.store.addIntent({ description: 'probe' })
  const mandate = await engine.createMandate({
    policy_version: 'v1',
    scope: { targets: ['10.0.0.5'], actions, backends: ['local'] },
    strength,
    source: 'user',
    basis: 'SOE'
  })
  const a = await engine.createAssignment({ intent_id: intent.id, mandate_id: mandate.id, backend: 'local' })
  return { intent, mandate, assignment: a }
}

describe('PrismEngine authorization (Host-enforced mandate)', () => {
  it('allows a read action within mandate scope without confirmation', async () => {
    const { assignment } = await setup('read', ['scan', 'read'])
    const d = await engine.authorize({ assignment_id: assignment.id, action: 'scan', target: '10.0.0.5' })
    expect(d.allowed).toBe(true)
    expect(d.requiresConfirm).toBe(false)
  })

  it('denies an action outside the mandate scope (no text could escalate)', async () => {
    const { assignment } = await setup('read', ['scan', 'read'])
    const d = await engine.authorize({ assignment_id: assignment.id, action: 'exploit', target: '10.0.0.5' })
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/action/i)
  })

  it('denies an out-of-scope target', async () => {
    const { assignment } = await setup('read', ['scan'])
    const d = await engine.authorize({ assignment_id: assignment.id, action: 'scan', target: '10.0.0.9' })
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/target/i)
  })

  it('denies every endpoint a command names, not only the declared one', async () => {
    const { assignment } = await setup('read', ['scan'])
    const d = await engine.authorize({
      assignment_id: assignment.id,
      action: 'scan',
      targets: ['10.0.0.5', '10.0.0.9']
    })
    expect(d.allowed).toBe(false)
    expect(d.reason).toContain('10.0.0.9')
    const ok = await engine.authorize({ assignment_id: assignment.id, action: 'scan', targets: ['10.0.0.5'] })
    expect(ok.allowed).toBe(true)
  })

  it('lets a generic run mandate cover reconnaissance but not destructive classes', async () => {
    const { assignment } = await setup('read', ['run'])
    expect((await engine.authorize({ assignment_id: assignment.id, action: 'read' })).allowed).toBe(true)
    expect((await engine.authorize({ assignment_id: assignment.id, action: 'scan' })).allowed).toBe(true)
    const write = await engine.authorize({ assignment_id: assignment.id, action: 'write' })
    expect(write.allowed).toBe(false)
    expect(write.reason).toMatch(/action/i)
    expect((await engine.authorize({ assignment_id: assignment.id, action: 'exploit' })).allowed).toBe(false)
  })

  it('requires confirmation for a high-strength (exploit) mandate', async () => {
    const { assignment } = await setup('exploit', ['exploit'])
    const d = await engine.authorize({ assignment_id: assignment.id, action: 'exploit', target: '10.0.0.5' })
    expect(d.allowed).toBe(true)
    expect(d.requiresConfirm).toBe(true)
  })

  it('pauses affected assignments and blocks further authorization when a mandate is revoked', async () => {
    const { mandate, assignment } = await setup('read', ['scan'])
    const res = await engine.revokeMandate(mandate.id)
    expect(res.paused).toContain(assignment.id)
    expect((await engine.getAssignment(assignment.id)).status).toBe('paused')
    const d = await engine.authorize({ assignment_id: assignment.id, action: 'scan', target: '10.0.0.5' })
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/paused/i)
  })
})
