// EventRecord — persisted FIRST, then routed/woken. Dedupe by dedupe_key so a
// repeated event never re-creates an intent or an assignment.
import { z } from 'zod'

export const EVENT_STATUSES = ['pending', 'processed', 'filtered', 'routed'] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

export const EventRecordSchema = z.object({
  id: z.string().regex(/^v\d{3,}$/, 'event id must be vNNN'),
  source: z.string().min(1),
  dedupe_key: z.string().min(1),
  owner_session: z.string().nullable().default(null),
  status: z.enum(EVENT_STATUSES).default('pending'),
  filter_reason: z.string().nullable().default(null),
  created_at: z.string().min(1)
})
export type EventRecord = z.infer<typeof EventRecordSchema>
