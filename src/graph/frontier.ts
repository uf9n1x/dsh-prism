// Frontier derivation. State is encoded in structure:
//   ready    ⟺ open (to === null) ∧ every from-fact exists ∧ (!confirm || approved)
//   done     ⟺ to !== null
//   running  ⟺ open ∧ claimed_by !== null
//   blocked  ⟺ open ∧ (missing dep ∨ (confirm ∧ !approved))
//   available = ready ∧ unclaimed
export type FrontierIntent = {
  id: string
  to: string | null
  from: string[]
  confirm: boolean
  approved: boolean
  claimed_by: string | null
}

export type FrontierFact = { id: string }

export interface Frontier {
  ready: FrontierIntent[]
  available: FrontierIntent[]
  running: FrontierIntent[]
  blocked: FrontierIntent[]
  done: FrontierIntent[]
}

export function isReady(intent: FrontierIntent, factIds: Set<string>): boolean {
  if (intent.to !== null) return false
  if (intent.confirm && !intent.approved) return false
  return intent.from.every((f) => factIds.has(f))
}

export function readyIntents(
  intents: readonly FrontierIntent[],
  facts: readonly FrontierFact[]
): FrontierIntent[] {
  const ids = new Set(facts.map((f) => f.id))
  return intents.filter((i) => isReady(i, ids))
}

export function classify(
  intents: readonly FrontierIntent[],
  facts: readonly FrontierFact[]
): Frontier {
  const ids = new Set(facts.map((f) => f.id))
  const out: Frontier = { ready: [], available: [], running: [], blocked: [], done: [] }
  for (const i of intents) {
    if (i.to !== null) {
      out.done.push(i)
    } else if (i.claimed_by !== null) {
      out.running.push(i)
    } else if (isReady(i, ids)) {
      out.ready.push(i)
      out.available.push(i)
    } else {
      out.blocked.push(i)
    }
  }
  return out
}
