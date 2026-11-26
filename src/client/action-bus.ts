/**
 * Lightweight browser-global bus for worktree modal actions triggered from
 * native sidebar context menus (`workspace`, `session`, `sessionHeader`) or
 * legacy session menu items.
 *
 * Actions render inside the root `shell.overlay` host so they survive route
 * changes and work for background workspaces/sessions whose composer
 * `BranchChip` is not mounted.
 */

export interface RepoFilterTarget {
  readonly repoRoot: string
  readonly repoName: string
}

export interface CheckoutPrLaunchOptions {
  readonly initialInput?: string | undefined
  readonly reuseBlankSessionId?: string | undefined
  readonly initialIfExists?: 'reuse' | 'update' | undefined
}

export type WorktreeOverlayAction =
  | { readonly kind: 'manage'; readonly repoFilter?: RepoFilterTarget }
  | { readonly kind: 'create'; readonly repoPath: string; readonly repoName: string }
  | { readonly kind: 'remove'; readonly path: string; readonly branch: string | null }
  | {
      readonly kind: 'checkout-pr'
      readonly repoPath: string
      readonly repoName: string
      readonly initialInput?: string
      readonly reuseBlankSessionId?: string
      readonly initialIfExists?: 'reuse' | 'update'
    }

let currentAction: WorktreeOverlayAction | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) listener()
}

/** Read the currently active overlay action, or null when idle. */
export function getWorktreeAction(): WorktreeOverlayAction | null {
  return currentAction
}

/** Subscribe to active overlay action changes. */
export function subscribeWorktreeAction(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Open the worktree manager modal, optionally pre-scoped to one repository. */
export function openManageWorktrees(repoFilter?: RepoFilterTarget): void {
  currentAction = repoFilter === undefined ? { kind: 'manage' } : { kind: 'manage', repoFilter }
  notify()
}

/** Open the create-worktree-from-branch modal for a repository workspace. */
export function openCreateWorktree(repoPath: string, repoName: string): void {
  currentAction = { kind: 'create', repoPath, repoName }
  notify()
}

/** Open the guarded worktree removal confirmation modal for a linked worktree path. */
export function openRemoveWorktree(path: string, branch: string | null): void {
  currentAction = { kind: 'remove', path, branch }
  notify()
}

/** Open the checkout-PR/MR-to-worktree modal for a repository workspace. */
export function openCheckoutPr(
  repoPath: string,
  repoName: string,
  initialInputOrOptions?: string | CheckoutPrLaunchOptions,
): void {
  const opts: CheckoutPrLaunchOptions = typeof initialInputOrOptions === 'string'
    ? { initialInput: initialInputOrOptions }
    : (initialInputOrOptions ?? {})
  currentAction = {
    kind: 'checkout-pr',
    repoPath,
    repoName,
    ...(opts.initialInput === undefined ? {} : { initialInput: opts.initialInput }),
    ...(opts.reuseBlankSessionId === undefined ? {} : { reuseBlankSessionId: opts.reuseBlankSessionId }),
    ...(opts.initialIfExists === undefined ? {} : { initialIfExists: opts.initialIfExists }),
  }
  notify()
}

/** Dismiss the active overlay action. */
export function closeWorktreeAction(): void {
  if (currentAction === null) return
  currentAction = null
  notify()
}
