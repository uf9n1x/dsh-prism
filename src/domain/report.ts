// Report — structured worker report back to the commander. Workers never ask the
// user directly; a waiting/blocked need is expressed here.
import { z } from 'zod'

export const REPORT_KINDS = ['progress', 'waiting', 'ready', 'blocked', 'failed', 'cancelled'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export const ReportSchema = z.object({
  id: z.string().regex(/^r\d{3,}$/, 'report id must be rNNN'),
  assignment_id: z.string().min(1),
  kind: z.enum(REPORT_KINDS),
  text: z.string().min(1),
  facts: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
  created_at: z.string().min(1)
})
export type Report = z.infer<typeof ReportSchema>
