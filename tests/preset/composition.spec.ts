import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

interface Row {
  id?: string
  name?: string
  disabled?: unknown
  config?: any
}
const root = join(import.meta.dirname, '..', '..')

function rows(rel: string): Row[] {
  const doc = parse(readFileSync(join(root, rel), 'utf8')) as { insert?: Row[] }[]
  const out: Row[] = []
  for (const entry of doc ?? []) for (const row of entry.insert ?? []) out.push(row)
  return out
}

const presetPlugins = (rel: string): Row[] => {
  const row = rows(rel).find((r) => r.config?.id !== undefined)
  return (row?.config?.plugins ?? []) as Row[]
}
const ids = (rs: Row[]) => new Set(rs.map((r) => r.id).filter(Boolean) as string[])
const names = (rs: Row[]) => rs.map((r) => r.name ?? '').join('\n')

const EXEC_ROW_IDS = ['tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'tool-web', 'tool-subagent', 'tool-mcp']
const EXEC_PKGS = ['dsh-tool-bash', 'dsh-tool-pwsh', 'dsh-tool-fs', 'dsh-tool-web', 'dsh-scanner-tools', 'dsh-mcp-client']

describe('P2 preset composition isolation', () => {
  const commander = presetPlugins('presets/prism.patch.yml')
  const worker = presetPlugins('presets/prism-worker.patch.yml')
  const cIds = ids(commander)
  const wIds = ids(worker)

  it('declares the Prism commander preset with the prism control row', () => {
    const declared = rows('presets/prism.patch.yml').find((r) => r.config?.id === 'prism')
    expect(declared?.name).toBe('@deepseek-ai/dsh-agent-preset')
    expect(String(declared?.config?.name)).toContain('Prism')
    expect(cIds.has('prism-commander')).toBe(true)
  })

  it('commander preset mounts NO execution rows or packages', () => {
    for (const id of EXEC_ROW_IDS) expect(cIds.has(id), `commander must not mount ${id}`).toBe(false)
    const cNames = names(commander)
    for (const pkg of EXEC_PKGS) expect(cNames, `commander must not mount ${pkg}`).not.toContain(pkg)
  })

  it('worker preset mounts execution rows and the prism worker row', () => {
    expect(wIds.has('tool-fs')).toBe(true)
    expect(wIds.has('prism-worker')).toBe(true)
    const hasShell = wIds.has('tool-bash') || wIds.has('tool-pwsh')
    expect(hasShell, 'worker needs a shell tool').toBe(true)
  })

  it('worker preset does not mount ask-user, goal, todo or delegation', () => {
    for (const id of ['tool-ask-user', 'tool-goal', 'tool-todo', 'tool-subagent', 'tool-subagent-control']) {
      expect(wIds.has(id), `worker must not mount ${id}`).toBe(false)
    }
  })

  it('worker preset does NOT mount the commander control row', () => {
    expect(wIds.has('prism-commander')).toBe(false)
  })

  it('neither preset mounts both control and exec roles', () => {
    expect(cIds.has('prism-commander') && cIds.has('tool-fs')).toBe(false)
    expect(wIds.has('prism-worker') && wIds.has('prism-commander')).toBe(false)
  })
})
