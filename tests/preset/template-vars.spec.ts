// The persona row only registers `provider` and `model` as template variables.
// Anything else fails at runtime with "unknown prompt variable", and the failure
// is not local: the whole turn dies before the model is ever called. This test
// pins the allowed set so a helpful-looking `{{cwd}}` cannot come back.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PRESETS = ['prism.patch.yml', 'prism-worker.patch.yml'] as const
const ALLOWED = new Set(['provider', 'model'])

function presetSource(name: string): string {
  return readFileSync(join(process.cwd(), 'presets', name), 'utf8')
}

function templateVars(source: string): string[] {
  return [...source.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)].map((match) => match[1]!)
}

describe('agent preset templates', () => {
  it.each(PRESETS)('%s only uses variables the persona row registers', (name) => {
    const used = templateVars(presetSource(name))
    const unknown = used.filter((variable) => !ALLOWED.has(variable))
    expect(unknown, `unknown prompt variables in ${name}`).toEqual([])
  })

  it.each(PRESETS)('%s mounts exactly one persona row with a non-empty prefix', (name) => {
    const source = presetSource(name)
    const personaRows = source.match(/name: '@deepseek-ai\/dsh-persona'/g) ?? []
    expect(personaRows).toHaveLength(1)
    const prefix = source.match(/prefix:\s*\|-\n([\s\S]*?)\n\s{14}\S|prefix:\s*\|-\n([\s\S]*)$/)
    expect(prefix, `${name} has no persona prefix block`).not.toBeNull()
  })

  it.each(PRESETS)('%s declares an agent-preset row with a stable id', (name) => {
    const source = presetSource(name)
    expect(source).toContain("name: '@deepseek-ai/dsh-agent-preset'")
    expect(source).toMatch(/^\s+id: prism(-worker)?$/m)
  })
})

describe('host tool rows carry the config their schemas require', () => {
  // Activating one of these rows without its config makes the whole preset
  // composition fail; the failure only shows up when a worker is actually
  // spawned, so a structural test is the cheap place to catch it.
  const REQUIRED: Record<string, string[]> = {
    '@deepseek-ai/dsh-tool-fs': ['applyPatch'],
    '@deepseek-ai/dsh-tool-fs-search': ['sampleOverCapGlobResults'],
    '@deepseek-ai/dsh-agent-instructions': ['maxBytes']
  }

  const read = (file: string): string =>
    readFileSync(join(process.cwd(), 'presets', file), 'utf8')

  for (const file of ['prism.patch.yml', 'prism-worker.patch.yml']) {
    it(`${file} configures every host tool row that requires one`, () => {
      const text = read(file)
      for (const [name, keys] of Object.entries(REQUIRED)) {
        const idx = text.indexOf(`name: '${name}'`)
        if (idx < 0) continue
        // The row's own block: from this line to the next "- id:" line.
        const rest = text.slice(idx)
        const nextRow = rest.indexOf('- id:', 1)
        const block = nextRow < 0 ? rest : rest.slice(0, nextRow)
        expect(block, `${name} in ${file} must declare a config block`).toContain('config:')
        for (const key of keys) expect(block, `${name} needs ${key}`).toContain(`${key}:`)
      }
    })
  }
})
