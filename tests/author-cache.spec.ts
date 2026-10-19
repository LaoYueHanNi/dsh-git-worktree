import { describe, expect, it } from 'vitest'
import { authorEpoch, cachedAuthors, forgetAuthors, rememberAuthors, resetAuthorCache } from '../src/client/author-cache.ts'

describe('page author cache', () => {
  it('returns a remembered tip and drops the oldest of 33', () => {
    resetAuthorCache()
    const tips = Array.from({ length: 33 }, (_, index) => index.toString(16).padStart(40, 'c'))
    for (const tip of tips) rememberAuthors('/repo', tip, [tip])
    expect(cachedAuthors('/repo', tips[32]!)).toEqual([tips[32]])
    expect(cachedAuthors('/repo', tips[0]!)).toBeUndefined()
    expect(cachedAuthors('/other', tips[32]!)).toBeUndefined()
    resetAuthorCache()
    expect(cachedAuthors('/repo', tips[32]!)).toBeUndefined()
  })

  it('drops one repository when branch info changes and ignores a late write', () => {
    resetAuthorCache()
    const tip = 'd'.repeat(40)
    const epoch = authorEpoch('/repo')
    rememberAuthors('/repo', tip, ['Ada'])
    rememberAuthors('/other', tip, ['Bea'])
    forgetAuthors('/repo')
    expect(cachedAuthors('/repo', tip)).toBeUndefined()
    expect(cachedAuthors('/other', tip)).toEqual(['Bea'])
    rememberAuthors('/repo', tip, ['Ada'], epoch)
    expect(cachedAuthors('/repo', tip)).toBeUndefined()
    rememberAuthors('/repo', tip, ['Cara'], authorEpoch('/repo'))
    expect(cachedAuthors('/repo', tip)).toEqual(['Cara'])
  })
})