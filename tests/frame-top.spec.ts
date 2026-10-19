import { describe, expect, it } from 'vitest'
import { hostFrameTop } from '../src/client/frame-top.ts'

describe('host frame top chrome', () => {
  it('uses the live chrome height, including an explicit zero while fullscreen', () => {
    expect(hostFrameTop('32px', '48px')).toBe(32)
    expect(hostFrameTop('0px', '48px')).toBe(0)
  })

  it('falls back to the static clearance when the live value is unset', () => {
    expect(hostFrameTop('', '48px')).toBe(48)
    expect(hostFrameTop(' ', '32')).toBe(32)
  })

  it('treats a missing host as no chrome', () => {
    expect(hostFrameTop('', '')).toBe(0)
    expect(hostFrameTop('auto', 'none')).toBe(0)
  })
})
