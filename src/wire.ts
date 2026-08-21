/**
 * Shared wire contract between the host half (HTTP routes under
 * `/plugin/git-worktree`) and the browser half (chip + plugin settings card).
 * Zero runtime dependencies: constants and types only, imported by both
 * builds.
 */

/** Absolute pathname prefix every route of this plugin lives under. */
export const ROUTE_PREFIX = '/plugin/git-worktree'

/** GET ROUTE_PREFIX/status?path=<absolute dir> */
export const ROUTE_STATUS = `${ROUTE_PREFIX}/status`

/** POST ROUTE_PREFIX/worktree — create-or-reuse a worktree for a branch. */
export const ROUTE_WORKTREE = `${ROUTE_PREFIX}/worktree`

/** POST ROUTE_PREFIX/switch — in-place branch switch of the main checkout. */
export const ROUTE_SWITCH = `${ROUTE_PREFIX}/switch`

/** One selectable branch row. */
export interface BranchEntry {
  /** Display name: a bare local name (`main`) or `<remote>/<name>`. */
  name: string
  kind: 'local' | 'remote'
}

/** One existing worktree of the repository. */
export interface WorktreeEntry {
  /** Absolute path of the worktree directory. */
  path: string
  /** Checked-out local branch name; absent for a detached or bare worktree. */
  branch: string | undefined
  /** True for the main worktree (the one holding `.git`). */
  main: boolean
}

/** Response of GET status — `repo: false` for a directory outside any git repository. */
export type RepoStatus =
  | { repo: false }
  | {
      repo: true
      /** Main repository directory basename — the root folder of `<rootDir>/<repoName>/`. */
      repoName: string
      /** Absolute path of the main worktree directory. */
      repoRoot: string
      /** Branch checked out by the directory the client asked about. */
      currentBranch: string
      /** Local branches plus remote branches without a same-named local one. */
      branches: BranchEntry[]
      /** Every worktree of the repository, main first (git order). */
      worktrees: WorktreeEntry[]
      /** Resolved worktree storage root (absolute) — what the settings say today. */
      rootDir: string
    }

/** POST worktree request body. */
export interface CreateWorktreeBody {
  /** Any directory inside the repository (workspace cwd). */
  repoPath: string
  /** Chosen branch display name: local (`feat-x`) or remote (`origin/feat-x`). */
  branch: string
}

/** POST worktree response body. */
export interface CreateWorktreeResult {
  /** The worktree directory (created or reused). */
  path: string
  /** False when an existing worktree for the branch was reused. */
  created: boolean
}

/** POST switch request body. */
export interface SwitchBody {
  /** Any directory inside the main worktree. */
  repoPath: string
  /** Target branch display name (local, or remote whose local twin is created by dwim). */
  branch: string
}

/** POST switch response body. */
export interface SwitchResult {
  /** The branch actually checked out after the switch. */
  branch: string
}

/** Error envelope every non-2xx response carries. */
export interface RouteError {
  error: string
}
