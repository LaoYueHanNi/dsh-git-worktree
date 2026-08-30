import { describe, expect, it } from 'vitest'
import { branchNameIssue, isAbsoluteConfigPath, localBranchName, sanitizeBranchDir, splitRemoteBranch } from '../src/normalize.ts'

describe('sanitizeBranchDir', () => {
  it('keeps plain names unchanged', () => {
    expect(sanitizeBranchDir('main')).toBe('main')
  })

  it('turns slashes into dashes', () => {
    expect(sanitizeBranchDir('feat/auth-login')).toBe('feat-auth-login')
    expect(sanitizeBranchDir('origin/feat/x')).toBe('origin-feat-x')
  })

  it('replaces Windows-forbidden characters', () => {
    expect(sanitizeBranchDir('a<b>c:d"e|f?g*h')).toBe('a-b-c-d-e-f-g-h')
  })

  it('merges dash runs and strips trailing dots and spaces', () => {
    expect(sanitizeBranchDir('a//--..b.. ')).toBe('a-b')
  })

  it('clamps to 64 characters without a forbidden suffix', () => {
    expect(sanitizeBranchDir('x'.repeat(80))).toHaveLength(64)
    expect(sanitizeBranchDir(`${'x'.repeat(63)}.`)).toBe('x'.repeat(63))
  })

  it('never returns an empty segment', () => {
    expect(sanitizeBranchDir('???')).toBe('branch')
    expect(sanitizeBranchDir('///')).toBe('branch')
  })
})

describe('localBranchName', () => {
  it('strips the leading remote segment', () => {
    expect(localBranchName('origin/feat/x')).toBe('feat/x')
    expect(localBranchName('upstream/main')).toBe('main')
  })

  it('passes local names through', () => {
    expect(localBranchName('main')).toBe('main')
    expect(localBranchName('feat/x')).toBe('x')
  })
})

describe('splitRemoteBranch', () => {
  it('splits a remote display name', () => {
    expect(splitRemoteBranch('origin/feat/x')).toEqual({ remote: 'origin', name: 'feat/x' })
  })

  it('returns undefined for bare words and leading-slash names', () => {
    expect(splitRemoteBranch('main')).toBeUndefined()
    expect(splitRemoteBranch('/weird')).toBeUndefined()
  })
})

describe('isAbsoluteConfigPath', () => {
  it('accepts POSIX, drive, and UNC forms', () => {
    expect(isAbsoluteConfigPath('/home/u/wt')).toBe(true)
    expect(isAbsoluteConfigPath('C:\\wt')).toBe(true)
    expect(isAbsoluteConfigPath('D:/wt')).toBe(true)
    expect(isAbsoluteConfigPath('\\\\server\\wt')).toBe(true)
  })

  it('rejects relative and empty values', () => {
    expect(isAbsoluteConfigPath('')).toBe(false)
    expect(isAbsoluteConfigPath('wt/x')).toBe(false)
    expect(isAbsoluteConfigPath('~/.dsh/wt')).toBe(false)
  })
})

describe('branchNameIssue', () => {
  it('accepts ordinary and nested names', () => {
    expect(branchNameIssue('main')).toBeNull()
    expect(branchNameIssue('feat/auth-login')).toBeNull()
    expect(branchNameIssue('v1.2.3')).toBeNull()
    expect(branchNameIssue('user@host')).toBeNull()
  })

  it('rejects empty and whitespace-only drafts', () => {
    expect(branchNameIssue('')).toBe('empty')
    expect(branchNameIssue('   ')).toBe('empty')
  })

  it('rejects a leading dash before git can parse it as a flag', () => {
    expect(branchNameIssue('-feat')).toBe('leadingDash')
  })

  it('rejects git-forbidden characters and constructs', () => {
    expect(branchNameIssue('a b')).toBe('illegal')
    expect(branchNameIssue('a..b')).toBe('illegal')
    expect(branchNameIssue('a~b')).toBe('illegal')
    expect(branchNameIssue('a^b')).toBe('illegal')
    expect(branchNameIssue('a:b')).toBe('illegal')
    expect(branchNameIssue('a?b')).toBe('illegal')
    expect(branchNameIssue('a*b')).toBe('illegal')
    expect(branchNameIssue('a[b')).toBe('illegal')
    expect(branchNameIssue('a\\b')).toBe('illegal')
    expect(branchNameIssue('a@{b')).toBe('illegal')
    expect(branchNameIssue('a//b')).toBe('illegal')
    expect(branchNameIssue('/lead')).toBe('illegal')
    expect(branchNameIssue('trail/')).toBe('illegal')
    expect(branchNameIssue('trailing.')).toBe('illegal')
    expect(branchNameIssue('.dotted')).toBe('illegal')
    expect(branchNameIssue('feat/.hidden')).toBe('illegal')
    expect(branchNameIssue('feat/x.lock')).toBe('illegal')
    expect(branchNameIssue('@')).toBe('illegal')
  })
})
