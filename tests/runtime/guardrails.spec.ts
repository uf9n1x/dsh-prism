import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assessGuardrails,
  GuardrailTracker,
  type GuardrailLimits,
  type GuardrailSnapshot,
  type GuardrailState
} from '../../src/runtime/guardrails'

const limits: GuardrailLimits = { maxAutoTurns: 3, stallMs: 1000, maxBlockedRepeats: 2, cooldownMs: 500 }

const zeroState = (): GuardrailState => ({ autoTurns: 0, lastHumanAt: 0, lastTripAt: 0 })
const snap = (over: Partial<GuardrailSnapshot> = {}): GuardrailSnapshot => ({
  autoTurns: 0,
  msSinceReport: null,
  msSinceOutputProgress: null,
  blockedRepeats: 0,
  ...over
})

describe('T2 guardrails: pure decisions (injectable clock, no timer)', () => {
  it('does not trip while every dimension is inside its limit', () => {
    expect(assessGuardrails(snap({ autoTurns: 2, msSinceReport: 100 }), zeroState(), limits, 10_000).tripped).toBe(false)
  })

  it('trips request-human when automatic turns exceed the budget', () => {
    const trip = assessGuardrails(snap({ autoTurns: 4 }), zeroState(), limits, 10_000)
    expect(trip).toMatchObject({ tripped: true, op: 'request-human', reason: 'over-turns' })
  })

  it('trips pause when there is neither a report nor output progress past the stall window', () => {
    const trip = assessGuardrails(snap({ msSinceReport: 5000, msSinceOutputProgress: 5000 }), zeroState(), limits, 10_000)
    expect(trip).toMatchObject({ tripped: true, op: 'pause', reason: 'stalled' })
  })

  it('does not call it stalled while output is still advancing', () => {
    expect(assessGuardrails(snap({ msSinceReport: 5000, msSinceOutputProgress: 10 }), zeroState(), limits, 10_000).tripped).toBe(false)
  })

  it('trips request-human on repeated blocked reports for one intent', () => {
    const trip = assessGuardrails(snap({ blockedRepeats: 2 }), zeroState(), limits, 10_000)
    expect(trip).toMatchObject({ tripped: true, op: 'request-human', reason: 'repeated-blocked' })
  })

  it('suppresses a second trip inside the cooldown window', () => {
    const state: GuardrailState = { autoTurns: 99, lastHumanAt: 0, lastTripAt: 9_800 }
    expect(assessGuardrails(snap({ autoTurns: 99 }), state, limits, 10_000).tripped).toBe(false)
  })
})

describe('T2 guardrails: tracker state machine with a fake clock', () => {
  it('counts auto turns, trips, then re-arms only after a human message', () => {
    let now = 1000
    const tracker = new GuardrailTracker(limits, () => now)
    tracker.onHuman('cmd')
    for (let i = 0; i < 4; i += 1) tracker.onAutoTurn('cmd')
    const trip = tracker.assess('cmd', { msSinceReport: 0, msSinceOutputProgress: 0, blockedRepeats: 0 })
    expect(trip.tripped).toBe(true)

    // A human message resets the automatic-turn budget and the cooldown.
    now = 5000
    tracker.onHuman('cmd')
    expect(tracker.assess('cmd', { msSinceReport: 0, msSinceOutputProgress: 0, blockedRepeats: 0 }).tripped).toBe(false)
  })

  it('enters cooldown after a trip and refuses a second trip until it elapses', () => {
    let now = 1000
    const tracker = new GuardrailTracker(limits, () => now)
    tracker.onHuman('cmd')
    tracker.onAutoTurn('cmd')
    tracker.onAutoTurn('cmd')
    tracker.onAutoTurn('cmd')
    tracker.onAutoTurn('cmd')
    expect(tracker.assess('cmd', { msSinceReport: 0, msSinceOutputProgress: 0, blockedRepeats: 0 }).tripped).toBe(true)
    // Still inside cooldown (500ms).
    now = 1200
    expect(tracker.assess('cmd', { msSinceReport: 0, msSinceOutputProgress: 0, blockedRepeats: 0 }).tripped).toBe(false)
    // After the window, it can trip again.
    now = 2000
    expect(tracker.assess('cmd', { msSinceReport: 0, msSinceOutputProgress: 0, blockedRepeats: 0 }).tripped).toBe(true)
  })
})

describe('T2 no fixed polling in the event loop', () => {
  it('the event-path modules contain no setInterval / polling loop', () => {
    const files = ['src/index.ts', 'src/runtime/fastpath.ts', 'src/runtime/guardrails.ts', 'src/runtime/outbox.ts', 'src/runtime/recover.ts']
    for (const rel of files) {
      const source = readFileSync(join(process.cwd(), rel), 'utf8')
      expect(source, `${rel} must not poll`).not.toMatch(/setInterval\s*\(/)
      expect(source, `${rel} must not sleep-loop`).not.toMatch(/while\s*\(\s*true\s*\)[^]*?await\s+sleep/)
    }
  })
})
