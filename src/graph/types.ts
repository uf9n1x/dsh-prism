// Graph domain schema — the single authority for entity shapes.
// Facts are immutable nodes; intents are work units (edges). State is encoded in
// structure (open/claimed/done + dependency existence + confirm/approved), never a
// redundant status mirror.
import { z } from 'zod'

export const EPOCH = '1970-01-01T00:00:00.000Z'

export const FactSchema = z.object({
  id: z.string().regex(/^(goal|f\d{3,})$/, 'fact id must be "goal" or fNNN'),
  title: z.string().min(1),
  summary: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  creator: z.string().min(1),
  source_intent: z.string().nullable().default(null),
  created_at: z.string().min(1)
})
export type Fact = z.infer<typeof FactSchema>

export const IntentSchema = z.object({
  id: z.string().regex(/^i\d{3,}$/, 'intent id must be iNNN'),
  description: z.string().min(1),
  from: z.array(z.string()).default([]),
  to: z.string().nullable().default(null),
  confirm: z.boolean().default(false),
  approved: z.boolean().default(false),
  claimed_by: z.string().nullable().default(null),
  backend: z.enum(['local', 'kali']).default('local'),
  stop_condition: z.string().nullable().default(null),
  created_at: z.string().min(1),
  updated_at: z.string().min(1).optional()
})
export type Intent = z.infer<typeof IntentSchema>

export const ProjectSchema = z.object({
  id: z.literal('proj'),
  origin: z.string().min(1),
  authorization: z.string().default(''),
  goal: z.string().min(1),
  status: z.enum(['active', 'done']).default('active'),
  counters: z.record(z.string(), z.number().int().nonnegative()).default({}),
  created_at: z.string().min(1),
  updated_at: z.string().optional()
})
export type Project = z.infer<typeof ProjectSchema>

export const WorkerSchema = z.object({
  id: z.string().regex(/^w\d{3,}$/),
  intent_id: z.string().nullable().default(null),
  backend: z.enum(['local', 'kali']).default('local'),
  status: z.enum(['spawning', 'running', 'idle', 'done', 'error', 'killed']),
  resumed_from: z.string().nullable().default(null),
  last_activity: z.string().nullable().default(null),
  created_at: z.string().min(1)
})
export type Worker = z.infer<typeof WorkerSchema>

export const MessageSchema = z.object({
  id: z.string().regex(/^m\d{3,}$/),
  from: z.string().min(1),
  to: z.string().min(1),
  text: z.string().min(1),
  intent_id: z.string().nullable().default(null),
  created_at: z.string().min(1)
})
export type Message = z.infer<typeof MessageSchema>

export const HintSchema = z.object({
  id: z.string().regex(/^h\d{3,}$/),
  text: z.string().min(1),
  source: z.enum(['user', 'system']).default('user'),
  created_at: z.string().min(1)
})
export type Hint = z.infer<typeof HintSchema>

export const EvidenceSchema = z.object({
  id: z.string().regex(/^e\d{3,}$/),
  title: z.string().min(1),
  summary: z.string().min(1),
  path: z.string().min(1),
  bytes: z.number().int().nonnegative().default(0),
  created_at: z.string().min(1)
})
export type Evidence = z.infer<typeof EvidenceSchema>

export const HandoverSchema = z.object({
  project_id: z.string().min(1),
  frontier: z.array(z.string()).default([]),
  workers: z.array(z.string()).default([]),
  notes: z.string().default(''),
  updated_at: z.string().min(1)
})
export type Handover = z.infer<typeof HandoverSchema>

export const COUNTER_KINDS = ['fact', 'intent', 'hint', 'worker', 'message', 'evidence'] as const
export type CounterKind = (typeof COUNTER_KINDS)[number]
