import { describe, expect, it } from 'vitest'
import { sectionOf, validateConfig } from '../src/index.ts'
import { validateRootDir } from '../src/settings.ts'

describe('validateRootDir', () => {
  it('accepts an absent or blank value (the default location)', () => {
    expect(() => validateRootDir(undefined)).not.toThrow()
    expect(() => validateRootDir('')).not.toThrow()
    expect(() => validateRootDir('   ')).not.toThrow()
  })

  it('accepts absolute paths on every platform shape', () => {
    expect(() => validateRootDir('D:\\wt')).not.toThrow()
    expect(() => validateRootDir('D:/wt')).not.toThrow()
    expect(() => validateRootDir('/wt')).not.toThrow()
    expect(() => validateRootDir('\\\\server\\share')).not.toThrow()
  })

  it('rejects a relative path', () => {
    expect(() => validateRootDir('wt/root')).toThrow(/absolute/)
  })
})

describe('config section shapes', () => {
  it('spells the shipped switch defaults in the composition layer', () => {
    expect(sectionOf({})).toEqual({
      groupSidebar: true,
      fetchBeforeCreate: false,
      autoPruneWorktrees: false,
      keepWorktrees: 30,
    })
    expect(sectionOf({ groupSidebar: false, fetchBeforeCreate: true, autoPruneWorktrees: true, keepWorktrees: 5 })).toEqual({
      groupSidebar: false,
      fetchBeforeCreate: true,
      autoPruneWorktrees: true,
      keepWorktrees: 5,
    })
    expect(sectionOf({ rootDir: 'D:\\wt' })).toEqual({
      rootDir: 'D:\\wt',
      groupSidebar: true,
      fetchBeforeCreate: false,
      autoPruneWorktrees: false,
      keepWorktrees: 30,
    })
    expect(sectionOf({ postCreateCopyFiles: ['.env'] })).toEqual({
      postCreateCopyFiles: ['.env'],
      groupSidebar: true,
      fetchBeforeCreate: false,
      autoPruneWorktrees: false,
      keepWorktrees: 30,
    })
  })

  it('validates the switch keys and rejects unknown keys', () => {
    expect(() => validateConfig({})).not.toThrow()
    expect(() => validateConfig({ groupSidebar: false, fetchBeforeCreate: true, autoPruneWorktrees: true, keepWorktrees: 1, postCreateCopyFiles: ['.env'] })).not.toThrow()
    expect(() => validateConfig({ groupSidebar: 'yes' })).toThrow('"groupSidebar" must be a boolean')
    expect(() => validateConfig({ fetchBeforeCreate: 'yes' })).toThrow('"fetchBeforeCreate" must be a boolean')
    expect(() => validateConfig({ autoPruneWorktrees: 'yes' })).toThrow('"autoPruneWorktrees" must be a boolean')
    expect(() => validateConfig({ postCreateCopyFiles: 'not-array' as unknown as string[] })).toThrow('"postCreateCopyFiles" must be an array of strings')
    expect(() => validateConfig({ postCreateCopyFiles: [123 as unknown as string] })).toThrow('"postCreateCopyFiles" must be an array of strings')
    expect(() => validateConfig({ groupSidebar: true, nope: 1 })).toThrow('unknown key "nope"')
  })

  it('requires the prune cap to be an integer >= 1', () => {
    expect(() => validateConfig({ keepWorktrees: 1 })).not.toThrow()
    expect(() => validateConfig({ keepWorktrees: 500 })).not.toThrow()
    expect(() => validateConfig({ keepWorktrees: 0 })).toThrow('integer >= 1')
    expect(() => validateConfig({ keepWorktrees: -3 })).toThrow('integer >= 1')
    expect(() => validateConfig({ keepWorktrees: 2.5 })).toThrow('integer >= 1')
    expect(() => validateConfig({ keepWorktrees: '30' })).toThrow('integer >= 1')
  })
})
