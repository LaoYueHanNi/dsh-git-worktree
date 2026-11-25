import { describe, expect, it } from 'vitest'
import { explainGitOpFailure, stripGitWrapper } from '../src/client/git-error.ts'

describe('explainGitOpFailure', () => {
  it('strips git command wrappers cleanly', () => {
    expect(stripGitWrapper('git switch feat failed (exit 1): error: Your local changes to the following files would be overwritten by checkout:'))
      .toBe('error: Your local changes to the following files would be overwritten by checkout:')
  })

  it('recognises dirty working tree conflicts on switch', () => {
    expect(explainGitOpFailure('git switch main failed (exit 1): error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/a.ts'))
      .toEqual({ kind: 'switchDirty' })
    expect(explainGitOpFailure('error: The following untracked working tree files would be overwritten by switch:\n\t.env'))
      .toEqual({ kind: 'switchDirty' })
  })

  it('recognises missing branch on switch', () => {
    expect(explainGitOpFailure('git switch ghost failed (exit 128): fatal: invalid reference: ghost'))
      .toEqual({ kind: 'switchMissing' })
  })

  it('recognises safe delete refusals for unmerged and checked-out branches', () => {
    expect(explainGitOpFailure("error: the branch 'feat/demo' is not fully merged.\nhint: If you are sure..."))
      .toEqual({ kind: 'deleteBranchUnmerged', branch: 'feat/demo' })
    expect(explainGitOpFailure("error: cannot delete branch 'feat/wt' used by worktree at '/repo/.dsh/gitworktree/feat-wt'"))
      .toEqual({ kind: 'deleteBranchCheckedOut', branch: 'feat/wt' })
    expect(explainGitOpFailure("error: Cannot delete branch 'main' checked out at '/repo'"))
      .toEqual({ kind: 'deleteBranchCheckedOut', branch: 'main' })
  })

  it('recognises worktree branch occupied and existing directory failures', () => {
    expect(explainGitOpFailure("fatal: 'feat/a' is already used by worktree at '/repo/.dsh/gitworktree/feat-a'"))
      .toEqual({ kind: 'worktreeOccupied', branch: 'feat/a' })
    expect(explainGitOpFailure("git worktree add failed (exit 128): fatal: '/repo/.dsh/gitworktree/feat' already exists"))
      .toEqual({ kind: 'worktreePathExists' })
  })

  it('returns null for unrecognised messages', () => {
    expect(explainGitOpFailure('')).toBeNull()
    expect(explainGitOpFailure('something completely different')).toBeNull()
  })
})
