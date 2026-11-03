// Mandate — immutable authorization credential. Enlarging scope requires a NEW
// mandate; an existing mandate is never mutated.
import { z } from 'zod'

export const BACKENDS = ['local', 'kali'] as const
export type Backend = (typeof BACKENDS)[number]

export const MANDATE_STRENGTHS = ['read', 'confirm', 'write', 'exploit'] as const
export type MandateStrength = (typeof MANDATE_STRENGTHS)[number]

export const MandateScopeSchema = z.object({
  targets: z.array(z.string().min(1)).default([]),
  actions: z.array(z.string().min(1)).default([]),
  backends: z.array(z.enum(BACKENDS)).default(['local'])
})
export type MandateScope = z.infer<typeof MandateScopeSchema>

export const MandateSchema = z.object({
  id: z.string().regex(/^md\d{3,}$/, 'mandate id must be mdNNN'),
  policy_version: z.string().min(1),
  scope: MandateScopeSchema,
  strength: z.enum(MANDATE_STRENGTHS),
  source: z.string().min(1),
  basis: z.string().min(1),
  created_at: z.string().min(1)
})
export type Mandate = z.infer<typeof MandateSchema>
