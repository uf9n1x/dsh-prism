// ExecutionRecord — asynchronous execution state: Jobs handle association, output
// cursor, idempotency/side-effect class and result.
import { z } from 'zod'

export const EXEC_STATUSES = ['running', 'done', 'failed', 'stopped'] as const
export type ExecStatus = (typeof EXEC_STATUSES)[number]

export const SIDE_EFFECTS = ['none', 'read', 'write', 'unknown'] as const
export type SideEffect = (typeof SIDE_EFFECTS)[number]

export const ExecutionRecordSchema = z.object({
  id: z.string().regex(/^x\d{3,}$/, 'execution id must be xNNN'),
  assignment_id: z.string().min(1),
  job_ref: z.string().nullable().default(null),
  status: z.enum(EXEC_STATUSES).default('running'),
  output_cursor: z.number().int().nonnegative().default(0),
  side_effect: z.enum(SIDE_EFFECTS).default('none'),
  result: z.string().nullable().default(null),
  created_at: z.string().min(1),
  updated_at: z.string().optional()
})
export type ExecutionRecord = z.infer<typeof ExecutionRecordSchema>
