import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sectionOf, validateConfig } from '../src/index.ts'
import {
  loadLegacySettings, migratedFileOf, planLegacyMigration, settingsFileOf, validateRootDir,
} from '../src/settings.ts'

/** Best-effort cleanup list (Windows file locks must not fail the suite). */
const cleanup: string[] = []

afterEach(async () => {
  while (cleanup.length > 0) {
    const dir = cleanup.pop()
    if (dir === undefined) continue
    await rm(dir, { recursive: true, force: true }).catch(() => { /* best-effort */ })
  }
})

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

describe('planLegacyMigration', () => {
  it('migrates a stored non-blank root when the user layer has none', () => {
    expect(planLegacyMigration({ rootDir: 'D:\\wt' }, undefined)).toBe('D:\\wt')
    expect(planLegacyMigration({ rootDir: ' D:\\wt ' }, {})).toBe('D:\\wt')
  })

  it('keeps the default when the legacy root is blank', () => {
    expect(planLegacyMigration({ rootDir: '' }, undefined)).toBeUndefined()
    expect(planLegacyMigration({ rootDir: '   ' }, {})).toBeUndefined()
  })

  it('never overwrites a user-layer choice, even an equal one', () => {
    expect(planLegacyMigration({ rootDir: 'D:\\wt' }, { rootDir: 'D:\\wt' })).toBeUndefined()
    expect(planLegacyMigration({ rootDir: 'D:\\wt' }, { rootDir: 'E:\\other' })).toBeUndefined()
  })
})

describe('loadLegacySettings', () => {
  it('answers the default when no document exists', async () => {
    const outcome = await loadLegacySettings(join(tmpdir(), 'dsh-gwt-nothing', 'settings.json'))
    expect(outcome).toEqual({ rootDir: '' })
  })

  it('answers the stored document', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-gwt-'))
    cleanup.push(dir)
    const file = join(dir, 'settings.json')
    await writeFile(file, '{"rootDir":"D:\\\\wt"}\n', 'utf8')
    expect(await loadLegacySettings(file)).toEqual({ rootDir: 'D:\\wt' })
  })

  it('answers the default for invalid documents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-gwt-'))
    cleanup.push(dir)
    const broken = join(dir, 'broken.json')
    await writeFile(broken, '{not json', 'utf8')
    expect(await loadLegacySettings(broken)).toEqual({ rootDir: '' })
    const array = join(dir, 'array.json')
    await writeFile(array, '[]', 'utf8')
    expect(await loadLegacySettings(array)).toEqual({ rootDir: '' })
    const mistyped = join(dir, 'mistyped.json')
    await writeFile(mistyped, '{"rootDir":5}', 'utf8')
    expect(await loadLegacySettings(mistyped)).toEqual({ rootDir: '' })
  })
})

describe('settings file locations', () => {
  it('places the legacy file under ~/.dsh/git-worktree', () => {
    expect(settingsFileOf('/home/u')).toBe(join('/home/u', '.dsh', 'git-worktree', 'settings.json'))
  })

  it('appends .migrated for the backup name', () => {
    expect(migratedFileOf('/home/u/.dsh/git-worktree/settings.json'))
      .toBe('/home/u/.dsh/git-worktree/settings.json.migrated')
  })
})

describe('config section shapes', () => {
  it('spells the grouping default ON in the composition layer', () => {
    expect(sectionOf({})).toEqual({ groupSidebar: true })
    expect(sectionOf({ groupSidebar: false })).toEqual({ groupSidebar: false })
    expect(sectionOf({ rootDir: 'D:\\wt' })).toEqual({ rootDir: 'D:\\wt', groupSidebar: true })
  })

  it('validates the grouping key and rejects unknown keys', () => {
    expect(() => validateConfig({})).not.toThrow()
    expect(() => validateConfig({ groupSidebar: false })).not.toThrow()
    expect(() => validateConfig({ groupSidebar: 'yes' })).toThrow('"groupSidebar" must be a boolean')
    expect(() => validateConfig({ groupSidebar: true, nope: 1 })).toThrow('unknown key "nope"')
  })
})
