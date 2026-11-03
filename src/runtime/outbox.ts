// Outbox runner. Domain commits enqueue Effects; the runner executes them after
// the commit and records the outcome. A failure that cannot prove the side
// effect did not land is recorded as `unknown`, which permanently removes the
// effect from automatic dispatch — replay is a human decision after a check.
import type { PrismEngine } from '../engine/engine.js'
import type { Effect } from '../domain/index.js'

export interface EffectOutcome {
  ok: boolean
  /** Set when the transport cannot tell whether the side effect landed. */
  unknown?: boolean
  detail?: string
}

export type EffectExecutor = (effect: Effect) => Promise<EffectOutcome>

export interface DrainReport {
  attempted: string[]
  done: string[]
  failed: string[]
  unknown: string[]
}

export class OutboxRunner {
  private readonly engine: PrismEngine
  private readonly executors = new Map<string, EffectExecutor>()
  private running = false

  constructor(engine: PrismEngine) {
    this.engine = engine
  }

  register(kind: string, executor: EffectExecutor): void {
    this.executors.set(kind, executor)
  }

  /** Execute every claimable effect once. Never re-enters itself. */
  async drain(): Promise<DrainReport> {
    const report: DrainReport = { attempted: [], done: [], failed: [], unknown: [] }
    if (this.running) return report
    this.running = true
    try {
      for (const effect of await this.engine.claimableEffects()) {
        report.attempted.push(effect.id)
        const executor = this.executors.get(effect.kind)
        if (executor === undefined) {
          await this.engine.markEffectUnknown(effect.id, `no executor registered for kind "${effect.kind}"`)
          report.unknown.push(effect.id)
          continue
        }
        try {
          const outcome = await executor(effect)
          if (outcome.ok) {
            await this.engine.completeEffect(effect.id)
            report.done.push(effect.id)
          } else if (outcome.unknown === true) {
            await this.engine.markEffectUnknown(effect.id, outcome.detail ?? 'outcome not observed')
            report.unknown.push(effect.id)
          } else {
            await this.engine.failEffect(effect.id, outcome.detail)
            report.failed.push(effect.id)
          }
        } catch (err) {
          // A thrown executor is ambiguous by default: only an effect declared
          // idempotent may be retried, everything else is quarantined.
          const message = (err as Error).message
          if (effect.idempotent) {
            await this.engine.failEffect(effect.id, message)
            report.failed.push(effect.id)
          } else {
            await this.engine.markEffectUnknown(effect.id, `executor threw: ${message}`)
            report.unknown.push(effect.id)
          }
        }
      }
    } finally {
      this.running = false
    }
    return report
  }

  /** Explicit retry of one effect after a human/policy decision. */
  async retry(id: string): Promise<void> {
    const effect = await this.engine.replayEffect(id)
    if (effect.status === 'pending') this.scheduleDrain()
  }

  scheduleDrain(): void {
    // Deferred to a microtask so callers finish their commit first.
    void Promise.resolve().then(() => this.drain())
  }
}
