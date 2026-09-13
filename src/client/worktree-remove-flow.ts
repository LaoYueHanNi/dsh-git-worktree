/**
 * The FULL "remove a worktree" semantics, parameterized: git-side removal
 * first (with the Windows leftover-folder recovery the /remove route needs),
 * then the DSH-side follow-up — archive the directory's sessions, drop the
 * workspace registration. Every deletion entry funnels through here (the
 * sidebar's confirm dialog, the settings-page manager, the lazy auto-prune)
 * so the three surfaces cannot drift apart: git first, so a refused removal
 * leaves the workspace world untouched.
 *
 * @module git-worktree/client/worktree-remove-flow
 */

/** The browser-side actions the flow needs. Structural minimums so callers
 * pass their injected faces directly. */
export interface WorktreeRemoveDeps {
  /** Remove one linked worktree (git registration + folder); rejects with
   * the host error text. */
  readonly removeWorktree: (path: string, force: boolean) => Promise<void>
  /** Batch directory-existence probe; undefined = the probe itself failed.
   * Used ONLY to disambiguate a Windows half-removal (git unregistered and
   * emptied the folder, then lost the last rmdir to an OS handle). */
  readonly probeDirectories: (paths: readonly string[]) =>
    Promise<{ exists: Readonly<Record<string, boolean>> } | undefined>
  /** Archive one session of the directory's workspace. */
  readonly archiveSession: (sessionId: string) => Promise<unknown>
  /** Drop the workspace registration. */
  readonly deleteWorkspace: (workspaceId: string) => Promise<unknown>
}

/** One removal request. A target with no `workspaceId` (an orphan the
 * manager lists but no workspace account holds) stops after the git half —
 * there is nothing to archive or unregister. */
export interface WorktreeRemoveTarget {
  /** Absolute worktree directory. */
  readonly path: string
  /** Pass `--force` past uncommitted changes. The INTERACTIVE entries
   * (sidebar, manager) set this from the inspected dirty count — the confirm
   * dialog already showed it; the lazy auto-prune always passes false. */
  readonly force: boolean
  /** The workspace registration to drop after the folder is really gone. */
  readonly workspaceId?: string
  /** Sessions to archive between the two halves (everything visible: not
   * archived, not blank, not a subagent row — blank rows hold nothing worth
   * archiving and an Ungrouped blank stays hidden anyway, while subagent
   * rows are never the user's to manage here). */
  readonly archiveSessionIds?: readonly string[]
}

/**
 * Remove one worktree completely. A refused git removal rethrows UNLESS the
 * directory is actually gone (the Windows half-removal shape: git already
 * unregistered and emptied the tree, then failed the final rmdir — the git
 * half is done, so the flow continues with the DSH half). Session archives
 * never abort the flow (a rejected archive is logged and skipped); a failed
 * workspace unregistration DOES reject — the caller's UI owns the retry.
 */
export async function removeWorktreeFully(deps: WorktreeRemoveDeps, target: WorktreeRemoveTarget): Promise<void> {
  try {
    await deps.removeWorktree(target.path, target.force)
  } catch (reason: unknown) {
    const probe = await deps.probeDirectories([target.path]).catch(() => undefined)
    if (probe?.exists[target.path] !== false) throw reason
  }
  for (const sessionId of target.archiveSessionIds ?? []) {
    await deps.archiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session archive rejected during worktree removal:', reason)
    })
  }
  if (target.workspaceId !== undefined) await deps.deleteWorkspace(target.workspaceId)
}
