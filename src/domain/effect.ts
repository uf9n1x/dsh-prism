// Effect / Outbox — persistent record of external side effects. Executed only
// after the domain commit. A result-unknown effect is marked `unknown` and must
// be reconciled, never blindly replayed.
import { z } from 'zod'

export const EFFECT_STATUSES = ['pending', 'done', 'failed', 'unknown'] as const
export type EffectStatus = (typeof EFFECT_STATUSES)[number]

export const EffectSchema = z.object({
  id: z.string().regex(/^x\d{3,}$/, 'effect id must be xNNN'),
  kind: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(EFFECT_STATUSES).default('pending'),
  attempts: z.number().int().nonnegative().default(0),
  idempotent: z.boolean().default(false),
  refs: z.array(z.string()).default([]),
  created_at: z.string().min(1),
  updated_at: z.string().optional()
})
export type Effect = z.infer<typeof EffectSchema>
