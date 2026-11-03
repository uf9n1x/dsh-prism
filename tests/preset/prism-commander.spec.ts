import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// BUG-003: the commander modelled a whole multi-step task as one long-running
// intent and never re-reasoned, so the fact-intent graph could not change with
// progress. The shipped `prism` preset must instruct an iterative planning
// cadence and intent closing. This locks the guidance into the deliverable.
const presetPath = join(process.cwd(), 'presets', 'prism.patch.yml')
const yml = readFileSync(presetPath, 'utf8')

describe('prism commander preset planning cadence (BUG-003)', () => {
  it('tells the commander to reason iteratively with prism_reason', () => {
    expect(yml).toContain('prism_reason')
    expect(yml.toLowerCase()).toMatch(/decompose|sub-intent|sub-goal|one intent per/)
  })

  it('tells the commander to close an intent when a result arrives', () => {
    expect(yml.toLowerCase()).toMatch(/close/)
  })

  it('keeps the goal small enough to see progress (not one long-running intent)', () => {
    expect(yml.toLowerCase()).toMatch(/single long-running intent|one intent per challenge/)
  })
})
