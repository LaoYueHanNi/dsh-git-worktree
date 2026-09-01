/**
 * Shared wire contract between the host half (HTTP routes under
 * `/plugin/git-worktree`) and the browser half (chip + plugin settings card).
 * Zero runtime dependencies: constants and types only, imported by both
 * builds.
 */
/** Absolute pathname prefix every route of this plugin lives under. */
export declare const ROUTE_PREFIX = "/plugin/git-worktree";
/** GET ROUTE_PREFIX/status?path=<absolute dir> */
export declare const ROUTE_STATUS = "/plugin/git-worktree/status";
/** POST ROUTE_PREFIX/worktree — create-or-reuse a worktree for a branch. */
export declare const ROUTE_WORKTREE = "/plugin/git-worktree/worktree";
/** POST ROUTE_PREFIX/switch — in-place branch switch of the main checkout. */
export declare const ROUTE_SWITCH = "/plugin/git-worktree/switch";
/** POST ROUTE_PREFIX/branch — create a NEW branch from the current checkout and switch to it. */
export declare const ROUTE_BRANCH = "/plugin/git-worktree/branch";
/** POST ROUTE_PREFIX/fetch — sync remote-tracking refs (fetch every remote + prune). */
export declare const ROUTE_FETCH = "/plugin/git-worktree/fetch";
/** POST ROUTE_PREFIX/update — fast-forward the current branch to its upstream. */
export declare const ROUTE_UPDATE = "/plugin/git-worktree/update";
/** POST ROUTE_PREFIX/group — git belonging facts for a batch of workspace paths. */
export declare const ROUTE_GROUP = "/plugin/git-worktree/group";
/** POST ROUTE_PREFIX/inspect — pre-delete facts for one worktree directory. */
export declare const ROUTE_INSPECT = "/plugin/git-worktree/inspect";
/** POST ROUTE_PREFIX/remove — delete one linked worktree (git registration + folder). */
export declare const ROUTE_REMOVE = "/plugin/git-worktree/remove";
/** POST ROUTE_PREFIX/exists — batch directory-existence probe (fs, no git). */
export declare const ROUTE_EXISTS = "/plugin/git-worktree/exists";
/** POST ROUTE_PREFIX/ensure-directory — mkdir -p a missing worktree storage slot. */
export declare const ROUTE_ENSURE_DIRECTORY = "/plugin/git-worktree/ensure-directory";
/** One selectable branch row. */
export interface BranchEntry {
    /** Display name: a bare local name (`main`) or `<remote>/<name>`. */
    name: string;
    kind: 'local' | 'remote';
    /** Commits the local branch is AHEAD of its upstream (local rows with an
     * upstream only; absent = no upstream or in sync). */
    ahead?: number;
    /** Commits the local branch is BEHIND its upstream (same conditions). */
    behind?: number;
}
/** One existing worktree of the repository. */
export interface WorktreeEntry {
    /** Absolute path of the worktree directory. */
    path: string;
    /** Checked-out local branch name; absent for a detached or bare worktree. */
    branch: string | undefined;
    /** True for the main worktree (the one holding `.git`). */
    main: boolean;
}
/** Response of GET status — `repo: false` for a directory outside any git repository. */
export type RepoStatus = {
    repo: false;
} | {
    repo: true;
    /** Main repository directory basename — the root folder of `<rootDir>/<repoName>/`. */
    repoName: string;
    /** Absolute path of the main worktree directory. */
    repoRoot: string;
    /** Branch checked out by the directory the client asked about. */
    currentBranch: string;
    /** Local branches plus every remote's remote-only branches (those
     * without a same-named local twin; `<remote>/HEAD` dropped). */
    branches: BranchEntry[];
    /** Every worktree of the repository, main first (git order). */
    worktrees: WorktreeEntry[];
    /** Resolved worktree storage root (absolute) — what the settings say today. */
    rootDir: string;
};
/** POST worktree request body. */
export interface CreateWorktreeBody {
    /** Any directory inside the repository (workspace cwd). */
    repoPath: string;
    /** Chosen branch display name: local (`feat-x`) or remote (`origin/feat-x`). */
    branch: string;
    /** True: cut a NEW branch out of `branch` (the current checkout's
     * branch — occupied by the main worktree) and isolate it in a fresh
     * worktree. The storage folder is named after the new branch. */
    cutout?: boolean;
    /** Cutout only: explicit name for the NEW branch. Default (absent):
     * derived `<branch>-wt`, suffixing past taken names. */
    name?: string;
}
/** POST worktree response body. */
export interface CreateWorktreeResult {
    /** The worktree directory (created or reused). */
    path: string;
    /** False when an existing worktree for the branch was reused. */
    created: boolean;
}
/** POST switch request body. */
export interface SwitchBody {
    /** Any directory inside the main worktree. */
    repoPath: string;
    /** Target branch display name (local, or remote whose local twin is created by dwim). */
    branch: string;
}
/** POST switch response body. */
export interface SwitchResult {
    /** The branch actually checked out after the switch. */
    branch: string;
}
/** POST branch request body. */
export interface CreateBranchBody {
    /** Any directory inside the repository (workspace cwd) — the new branch is
     * cut from whatever this directory's HEAD points at and checked out HERE. */
    repoPath: string;
    /** User-typed name of the branch to create (a local name, verbatim). */
    name: string;
}
/** POST branch response body. */
export interface CreateBranchResult {
    /** The branch created and now checked out. */
    branch: string;
}
/** POST fetch request body. */
export interface FetchBody {
    /** Any directory inside the repository (workspace cwd). */
    repoPath: string;
}
/** POST fetch response body — the fetch mutates refs server-side; the
 * client refetches /status for the fresh branch list. */
export interface FetchResult {
    /** What the fetch covered: "all" remotes (this plugin always fetches all). */
    remote: string;
}
/** POST update request body. */
export interface UpdateBody {
    /** Any directory inside the repository (workspace cwd) — the branch
     * checked out by THIS directory is the one updated. */
    repoPath: string;
}
/** POST update response body — fetch every remote, then fast-forward the
 * checked-out branch to its upstream. */
export interface UpdateResult {
    /** The branch that was updated (empty for a detached checkout, which
     * cannot be updated and always errors before this response). */
    branch: string;
    /** False when the upstream already contained the branch (nothing moved). */
    updated: boolean;
}
/** Error envelope every non-2xx response carries. */
export interface RouteError {
    error: string;
}
/** Git belonging facts of one workspace directory; null = not a git repository. */
export interface WorkspaceGitFacts {
    /** Grouping key: the repository's main worktree directory (canonical). */
    repoRoot: string;
    /** Group title: the main repository directory basename. */
    repoName: string;
    /** Branch checked out by this directory; null = detached or unborn HEAD. */
    branch: string | null;
    /** True when this directory IS the main worktree (holds the shared .git). */
    main: boolean;
}
/** POST group request body. */
export interface GroupWorkspacesBody {
    /** Absolute workspace directories to probe (deduped server-side). */
    paths: string[];
}
/** POST group response body — one entry per DISTINCT requested path. */
export interface GroupWorkspacesResult {
    /** Git facts per path; null marks a path outside any git repository. */
    facts: Record<string, WorkspaceGitFacts | null>;
}
/** POST inspect request body. */
export interface InspectWorktreeBody {
    /** The worktree directory to inspect (absolute). */
    path: string;
}
/** POST inspect response body — the facts the remove-confirm dialog shows. */
export interface InspectWorktreeResult {
    /** Uncommitted changes in the directory (staged + unstaged + untracked
     * file rows of `git status --porcelain`). */
    dirty: number;
    /** Commits the checked-out branch is ahead of its upstream; absent = no
     * upstream. Purely informational: the branch ref survives the removal, so
     * these commits are NOT lost. */
    ahead?: number;
}
/** POST remove request body. */
export interface RemoveWorktreeBody {
    /** The linked worktree directory to delete (absolute). */
    path: string;
    /** True: force past uncommitted changes (the confirm dialog already
     * showed the dirty count). */
    force?: boolean;
}
/** POST remove response body. */
export interface RemoveWorktreeResult {
    /** The removed worktree directory. */
    path: string;
    /** True when only a stale registration was pruned (the directory was
     * already gone); false when `git worktree remove` deleted a live folder. */
    pruned: boolean;
}
/** POST exists request body. */
export interface PathExistsBody {
    /** Absolute directories to probe (deduped server-side). */
    paths: string[];
}
/** POST exists response body — one entry per DISTINCT requested path; true =
 * the path exists AND is a directory. The client gates the register action on
 * this, so a missing folder never reaches the DSH workspace API. */
export interface PathExistsResult {
    exists: Record<string, boolean>;
    /** Per MISSING path: true when it sits DIRECTLY inside the plugin's
     * worktree storage root — a slot this plugin planned, so rebuilding the
     * empty directory is safe (historical sessions reattach automatically once
     * realpath matches again). Absent paths and directories outside the root
     * never appear here. */
    rebuildable?: Record<string, boolean>;
}
/** POST ensure-directory request body. */
export interface EnsureDirectoryBody {
    /** The missing directory to create (absolute; must sit directly inside the
     * worktree storage root). */
    path: string;
}
/** POST ensure-directory response body. */
export interface EnsureDirectoryResult {
    /** Always true on 200 — the directory now exists (created, or already
     * present as a directory). */
    created: boolean;
}
