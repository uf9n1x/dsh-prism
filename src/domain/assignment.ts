// Assignment — one worker execution attempt. Independent of native Session
// runtime state; supports failure / retry / worker swap / cold resume / history.
import { z } from 'zod'
import { BACKENDS } from './mandate.js'

export const ASSIGNMENT_STATUSES = [
  'spawned',
  'running',
  'waiting',
  'ready',
  'done',
  'failed',
  'cancelled',
  'paused',
  'interrupted'
] as const
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number]

/** Statuses that a mandate revocation / tightening must pause. */
export const ACTIVE_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  'spawned',
  'running',
  'waiting',
  'ready'
]

export const AssignmentSchema = z.object({
  id: z.string().regex(/^a\d{3,}$/, 'assignment id must be aNNN'),
  intent_id: z.string().min(1),
  mandate_id: z.string().min(1),
  backend: z.enum(BACKENDS),
  worker_session: z.string().nullable().default(null),
  status: z.enum(ASSIGNMENT_STATUSES),
  attempts: z.number().int().nonnegative().default(0),
  resume_of: z.string().nullable().default(null),
  created_at: z.string().min(1),
  updated_at: z.string().optional()
})
export type Assignment = z.infer<typeof AssignmentSchema>
