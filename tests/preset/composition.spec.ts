import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

interface Row {
  id?: string
  name?: string
}
const root = join(import.meta.dirname, '..', '..')

function rows(rel: string): Row[] {
  const doc = parse(readFileSync(join(root, rel), 'utf8'))
  return (doc as Row[]) ?? []
}
const ids = (rs: Row[]) => new Set(rs.map((r) => r.id).filter(Boolean) as string[])
const names = (rs: Row[]) => rs.map((r) => r.name ?? '').join('\n')

const EXEC_ROW_IDS = ['tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'tool-web', 'tool-scanner', 'tool-subagent', 'tool-mcp']
const EXEC_PKGS = ['dsh-tool-bash', 'dsh-tool-pwsh', 'dsh-tool-fs', 'dsh-tool-web', 'dsh-scanner-tools', 'dsh-mcp-client', 'dsh-tool-subagent']

describe('P2 preset composition isolation', () => {
  const commander = rows('preset/prism/agent.cordis.yml')
  const worker = rows('preset/prism-worker/agent.cordis.yml')
  const cIds = ids(commander)
  const wIds = ids(worker)

  it('commander preset declares the prism control row', () => {
    expect(cIds.has('prism-control')).toBe(true)
  })

  it('commander preset mounts NO execution rows or packages', () => {
    for (const id of EXEC_ROW_IDS) expect(cIds.has(id), `commander must not mount ${id}`).toBe(false)
    const cNames = names(commander)
    for (const pkg of EXEC_PKGS) expect(cNames, `commander must not mount ${pkg}`).not.toContain(pkg)
  })

  it('worker preset mounts execution rows and the prism worker row', () => {
    expect(wIds.has('tool-fs')).toBe(true)
    expect(wIds.has('tool-web')).toBe(true)
    expect(wIds.has('prism-worker')).toBe(true)
    const hasShell = wIds.has('tool-bash') || wIds.has('tool-pwsh')
    expect(hasShell, 'worker needs a shell tool').toBe(true)
  })

  it('worker preset does NOT mount the commander control row', () => {
    expect(wIds.has('prism-control')).toBe(false)
  })

  it('neither preset mounts both control and exec roles', () => {
    expect(cIds.has('prism-control') && cIds.has('tool-fs')).toBe(false)
    expect(wIds.has('prism-worker') && wIds.has('prism-control')).toBe(false)
  })
})
