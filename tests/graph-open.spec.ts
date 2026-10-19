import { describe, expect, it } from 'vitest'
import { graphOpenAfter } from '../src/client/graph-open.ts'

describe('default graph on branch-menu open', () => {
  it('opens the graph when the menu opens and the setting is on', () => {
    expect(graphOpenAfter(false, true, true, false)).toBe(true)
  })

  it('keeps a manually opened graph when the setting is off', () => {
    expect(graphOpenAfter(false, true, false, true)).toBe(true)
    expect(graphOpenAfter(false, true, false, false)).toBe(false)
  })

  it('does not change the mode of a menu that is already open', () => {
    expect(graphOpenAfter(true, true, true, false)).toBe(false)
    expect(graphOpenAfter(true, false, true, true)).toBe(true)
  })
})
