/**
 * Classify common interactive git errors (in-place switch, safe branch delete,
 * worktree creation) into localized user-facing failure kinds instead of
 * surfacing raw `git ... failed (exit N): ...` stderr blobs.
 *
 * @module git-worktree/client/git-error
 */

/** Recognised failure categories for branch & worktree mutations. */
export type GitOpFailureKind =
  | 'switchDirty'
  | 'switchMissing'
  | 'deleteBranchUnmerged'
  | 'deleteBranchCheckedOut'
  | 'worktreeOccupied'
  | 'worktreePathExists'

export interface GitOpFailure {
  readonly kind: GitOpFailureKind
  readonly branch?: string
}

/**
 * Strip `git <args> failed (exit N): ` wrapper prefixes so pattern matching
 * operates on git's own diagnostic lines.
 */
export function stripGitWrapper(raw: string): string {
  return raw.replace(/^git\b[\s\S]*?\bfailed\s*\(exit\s+\d+\):\s*/i, '').trim()
}

/**
 * Recognise frequent, actionable git failure messages from switch, branch
 * delete, and worktree creation operations.
 * @param raw - raw error text returned by the host route.
 * @returns structured failure kind when recognised, else null.
 */
export function explainGitOpFailure(raw: string): GitOpFailure | null {
  const text = stripGitWrapper(raw)
  if (text === '') return null

  // In-place switch blocked by uncommitted local changes or untracked collisions.
  if (
    /Your local changes to the following files would be overwritten by (?:checkout|switch)/i.test(text)
    || /The following untracked working tree files would be overwritten by (?:checkout|switch)/i.test(text)
    || /you need to resolve your current index first/i.test(text)
  ) {
    return { kind: 'switchDirty' }
  }

  // Missing branch / invalid ref on switch.
  if (/invalid reference:/i.test(text) || /pathspec .* did not match any file/i.test(text)) {
    return { kind: 'switchMissing' }
  }

  // Safe `git branch -d` refusing an unmerged branch.
  const unmerged = /the branch '([^']+)' is not fully merged/i.exec(text)
  if (unmerged !== null) {
    return unmerged[1] === undefined
      ? { kind: 'deleteBranchUnmerged' }
      : { kind: 'deleteBranchUnmerged', branch: unmerged[1] }
  }

  // `git branch -d` refusing a branch checked out in current or linked worktree.
  if (
    /cannot delete (?:the )?branch '([^']+)' (?:used by worktree|checked out)/i.test(text)
    || /Cannot delete branch .* checked out at/i.test(text)
  ) {
    const match = /branch '([^']+)'/i.exec(text)
    return match?.[1] === undefined
      ? { kind: 'deleteBranchCheckedOut' }
      : { kind: 'deleteBranchCheckedOut', branch: match[1] }
  }

  // `git worktree add` refusing a branch already checked out in another worktree.
  const occupied = /'([^']+)' is already (?:checked out|used by worktree)/i.exec(text)
  if (occupied !== null) {
    return occupied[1] === undefined
      ? { kind: 'worktreeOccupied' }
      : { kind: 'worktreeOccupied', branch: occupied[1] }
  }

  // `git worktree add` refusing an existing non-empty target folder.
  if (/already exists/i.test(text) && /worktree|destination path|fatal:/i.test(raw)) {
    return { kind: 'worktreePathExists' }
  }

  return null
}
