// Windows-safe helpers: a directory-based advisory lock (replaces POSIX fcntl),
// an atomic JSON write (temp + fsync + rename), and a JSON reader.
import { mkdir, rm, stat, readFile, writeFile, unlink, open, rename, access } from 'node:fs/promises'
import { dirname, basename, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export interface LockOptions {
  timeoutMs?: number
  staleMs?: number
  retryMs?: number
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function existsPath(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Acquire an exclusive lock by atomically creating a lock DIRECTORY (mkdir is
 * atomic on NTFS and POSIX alike). A stale lock (older than staleMs, e.g. a
 * crashed process) is reclaimed. Kept deliberately simple: all Prism critical
 * sections are short (allocate id + write one node + update counters).
 */
export async function withLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts: LockOptions = {}
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 15000
  const staleMs = opts.staleMs ?? 60000
  const retryMs = opts.retryMs ?? 10
  const owner = join(lockPath, 'owner.json')
  const start = Date.now()

  for (;;) {
    try {
      await mkdir(lockPath, { recursive: false })
      await writeFile(owner, JSON.stringify({ pid: process.pid, ts: Date.now() }), 'utf8').catch(
        () => undefined
      )
      break
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw err
      // The lock dir exists — decide whether it is stale.
      let stale = false
      try {
        const st = await stat(lockPath)
        stale = Date.now() - st.mtimeMs > staleMs
        if (!stale) {
          try {
            const o = JSON.parse(await readFile(owner, 'utf8')) as { ts?: number }
            if (typeof o.ts === 'number') stale = Date.now() - o.ts > staleMs
          } catch {
            /* owner not written yet — rely on mtime */
          }
        }
      } catch {
        /* raced away; retry */
      }
      if (stale) {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
        continue
      }
      if (Date.now() - start > timeoutMs) throw new Error(`lock timeout on ${lockPath}`)
      await sleep(retryMs + Math.floor(Math.random() * retryMs))
    }
  }

  try {
    return await fn()
  } finally {
    await unlink(owner).catch(() => undefined)
    await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Write JSON atomically: temp file in the same dir, fsync, then rename. */
export async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const dir = dirname(path)
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(JSON.stringify(data, null, 2) + '\n', 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await rename(tmp, path)
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
}

export async function readJson<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}
