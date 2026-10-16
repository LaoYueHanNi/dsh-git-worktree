import { describe, expect, it } from 'vitest'
import { explainUpdateFailure, updateErrorText } from '../src/client/update-error.ts'

const diverged = [
  'git merge --ff-only @{u} failed (exit 1): hint: Diverging branches can\'t be fast-forwarded, you need to either:',
  'hint: hint: git merge --no-ff',
  'hint: hint: or:',
  'hint: hint: git rebase',
  'hint: hint: Disable this message with "git config advice.diverging false"',
  'fatal: Not possible to fast-forward, aborting.',
].join('\n')

describe('explainUpdateFailure', () => {
  it.each([
    ['diverged', diverged],
    ['diverged', 'fatal: Not possible to fast-forward, aborting.'],
    ['dirty', 'error: Your local changes to the following files would be overwritten by merge:\n\tREADME.md\nPlease commit your changes or stash them before you merge.\nAborting'],
    ['noUpstream', "fatal: no upstream configured for branch 'feature/x'"],
    ['noUpstream', 'There is no tracking information for the current branch.'],
  ] as const)('recognises %s', (kind, raw) => {
    expect(explainUpdateFailure(raw)).toBe(kind)
  })

  it('returns null for a failure it does not know', () => {
    expect(explainUpdateFailure('fatal: early EOF')).toBeNull()
    expect(explainUpdateFailure('')).toBeNull()
  })
})

describe('updateErrorText', () => {
  it('drops the command line and every hint, keeping the fatal line', () => {
    expect(updateErrorText(diverged)).toBe('fatal: Not possible to fast-forward, aborting.')
  })

  it('leaves an already plain failure alone', () => {
    expect(updateErrorText('fatal: early EOF')).toBe('fatal: early EOF')
  })
})
