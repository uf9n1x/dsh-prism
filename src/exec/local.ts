// LocalBackend — Windows host execution with a bounded output ring.
//
// The process is detached from the tool call: `start` resolves as soon as the
// child exists, `output` reads forward from a cursor, `stop` kills the tree.
// Output is capped so a chatty scan cannot exhaust host memory, and truncation
// is reported instead of silently dropping text.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ExecStatus } from '../domain/index.js'
import type { ExecutionBackend, ExecHandle, ExecRequest, HealthStatus, OutputChunk } from './backend.js'

const MAX_BUFFER_BYTES = 512 * 1024
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

interface Job {
  ref: string
  child: ChildProcess
  buffer: string
  dropped: number
  status: ExecStatus
  exitCode: number | null
  startedAt: number
  timer?: ReturnType<typeof setTimeout>
}

export class LocalBackend implements ExecutionBackend {
  readonly kind = 'local' as const
  private readonly jobs = new Map<string, Job>()

  async healthCheck(): Promise<HealthStatus> {
    return {
      backend: 'local',
      ok: true,
      verified: process.platform === 'win32' || process.platform === 'linux',
      detail: `local shell execution on ${process.platform}`
    }
  }

  async start(request: ExecRequest): Promise<ExecHandle> {
    const ref = `local-${randomUUID()}`
    const isWin = process.platform === 'win32'
    const file = isWin ? 'cmd.exe' : '/bin/sh'
    const args = isWin ? ['/d', '/s', '/c', request.command] : ['-c', request.command]
    const child = spawn(file, args, {
      cwd: request.cwd,
      env: { ...process.env, ...request.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const job: Job = {
      ref,
      child,
      buffer: '',
      dropped: 0,
      status: 'running',
      exitCode: null,
      startedAt: Date.now()
    }
    const append = (text: string) => {
      job.buffer += text
      if (job.buffer.length > MAX_BUFFER_BYTES) {
        const cut = job.buffer.length - MAX_BUFFER_BYTES
        job.buffer = job.buffer.slice(cut)
        job.dropped += cut
      }
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => append(d))
    child.stderr?.on('data', (d: string) => append(d))
    child.on('error', (err) => {
      append(`\n[spawn error] ${err.message}\n`)
      job.status = 'failed'
    })
    child.on('close', (code) => {
      job.exitCode = code
      if (job.status === 'running') job.status = code === 0 ? 'done' : 'failed'
      if (job.timer !== undefined) clearTimeout(job.timer)
    })
    const timeout = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
    job.timer = setTimeout(() => void this.stop(ref), timeout)
    job.timer.unref?.()
    this.jobs.set(ref, job)
    return { ref, backend: 'local', started_at: new Date(job.startedAt).toISOString() }
  }

  async output(ref: string, cursor: number): Promise<OutputChunk> {
    const job = this.jobs.get(ref)
    if (job === undefined) {
      return { chunk: '', cursor, status: 'failed', exit_code: null, truncated: false }
    }
    const from = Math.max(0, cursor)
    const chunk = job.buffer.slice(from)
    return {
      chunk,
      cursor: from + chunk.length,
      status: job.status,
      exit_code: job.exitCode,
      truncated: job.dropped > 0
    }
  }

  async stop(ref: string): Promise<void> {
    const job = this.jobs.get(ref)
    if (job === undefined) return
    if (job.status === 'running') {
      job.status = 'stopped'
      try {
        if (process.platform === 'win32' && job.child.pid !== undefined) {
          // Kill the whole tree: cmd.exe children survive a signal to the shell.
          spawn('taskkill', ['/pid', String(job.child.pid), '/t', '/f'], { windowsHide: true })
        } else {
          job.child.kill('SIGTERM')
        }
      } catch {
        job.child.kill()
      }
    }
    if (job.timer !== undefined) clearTimeout(job.timer)
  }

  /** Test/ops helper: drop finished handles once their record is closed. */
  forget(ref: string): void {
    this.jobs.delete(ref)
  }

  /** Live handle count (diagnostics). */
  get size(): number {
    return this.jobs.size
  }
}
