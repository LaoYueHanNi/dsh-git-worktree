import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractReleaseNotes } from '../scripts/release-notes.mjs'

describe('extractReleaseNotes', () => {
  const sample = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [0.5.0-rc.1] - 2026-12-01',
    '',
    '### Added',
    '- Pre-release feature',
    '',
    '## [0.4.16] - 2026-11-28',
    '',
    '### Fixed',
    '- Fix A',
    '',
    '## [0.4.15] - 2026-11-27',
    '',
    '### Added',
    '- Old feature',
    '',
    '[0.5.0-rc.1]: https://github.com/org/repo/compare/0.4.16...0.5.0-rc.1',
    '[0.4.16]: https://github.com/org/repo/compare/0.4.15...0.4.16',
    '[0.4.15]: https://github.com/org/repo/compare/0.4.14...0.4.15',
  ].join('\n')

  it('extracts a middle section cleanly and appends its compare link', () => {
    const notes = extractReleaseNotes(sample, '0.4.16')
    expect(notes).toBe('### Fixed\n- Fix A\n\n**完整变更对比**: https://github.com/org/repo/compare/0.4.15...0.4.16')
  })

  it('accepts leading v prefix and pre-release versions', () => {
    const notes = extractReleaseNotes(sample, 'v0.5.0-rc.1')
    expect(notes).toContain('Pre-release feature')
    expect(notes).toContain('0.4.16...0.5.0-rc.1')
  })

  it('strips trailing reference link definitions from the last section', () => {
    const notes = extractReleaseNotes(sample, '0.4.15')
    expect(notes).toBe('### Added\n- Old feature\n\n**完整变更对比**: https://github.com/org/repo/compare/0.4.14...0.4.15')
  })

  it('returns null when version is missing or section is empty', () => {
    expect(extractReleaseNotes(sample, '9.9.9')).toBeNull()
    expect(extractReleaseNotes(sample, 'Unreleased')).toBeNull()
  })

  it('parses the repository CHANGELOG.md for shipped versions', () => {
    const real = readFileSync(resolve('CHANGELOG.md'), 'utf8')
    const v0416 = extractReleaseNotes(real, '0.4.16')
    const v0415 = extractReleaseNotes(real, '0.4.15')
    expect(v0416).toContain('一键检出 PR / MR 到独立隔离工作树')
    expect(v0416).toContain('https://github.com/LaoYueHanNi/dsh-git-worktree/compare/0.4.15...0.4.16')
    expect(v0415).toContain('原生侧边栏右键菜单与工作树角标')
    expect(v0415).toContain('https://github.com/LaoYueHanNi/dsh-git-worktree/compare/0.4.14...0.4.15')
  })
})
