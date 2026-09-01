/**
 * Git command wrapper for the host half. All git access goes through one
 * injectable `exec` seam (tests substitute it); every method is plain
 * argument assembly plus porcelain parsing, no ambient state.
 */
import type { BranchEntry, WorktreeEntry, WorkspaceGitFacts } from './wire.js';
/** One process result as the seam reports it. */
export interface ExecResult {
    code: number;
    stdout: string;
    stderr: string;
}
/**
 * Process executor seam. Runs `file args` with cwd set, captures output as
 * UTF-8 text, and never throws — a non-zero exit is a normal result.
 */
export type Exec = (file: string, args: readonly string[], options: {
    cwd: string;
}) => Promise<ExecResult>;
/** Failure of one git invocation: non-zero exit with the stderr text. */
export declare class GitError extends Error {
    readonly args: readonly string[];
    readonly code: number;
    readonly stderr: string;
    constructor(args: readonly string[], code: number, stderr: string);
}
/** Facts the status route assembles: branches, worktrees, repo identity. */
export interface RepoFacts {
    /** Absolute main worktree path (`rev-parse --show-toplevel` of the main dir). */
    repoRoot: string;
    /** Main repository directory basename. */
    repoName: string;
    /** Branch checked out by the queried directory. */
    currentBranch: string;
    branches: BranchEntry[];
    worktrees: WorktreeEntry[];
}
/** Real executor over node:child_process with a hard timeout. */
export declare function childProcessExec(file: string, args: readonly string[], options: {
    cwd: string;
}): Promise<ExecResult>;
/** Directory-existence seam over the parsed worktree registrations. */
export type DirExists = (path: string) => boolean;
/** Real existence check. */
export declare const fsDirExists: DirExists;
/**
 * Resolve a directory to repository facts, or undefined outside any git
 * repository (including the `git` binary missing: ENOENT surfaces as a
 * non-zero exit through the seam).
 * @param exec - executor seam.
 * @param path - absolute directory the workspace reports.
 * @param dirExists - existence seam for stale-registration filtering.
 */
export declare function probeRepo(exec: Exec, path: string, dirExists?: DirExists): Promise<RepoFacts | undefined>;
/**
 * Create (or reuse) the worktree for one branch.
 *
 * Idempotence: git allows one worktree per checked-out branch, so an existing
 * worktree already on `branch` (compared by local name) is returned unreused.
 * A local branch gets `git worktree add <path> <name>`; a remote-only branch
 * gets a new local twin via `git worktree add <path> -b <name> <remoteRef>`.
 * @param exec - executor seam.
 * @param repoRoot - main worktree directory.
 * @param branch - branch display name.
 * @param targetPath - absolute directory to create.
 * @returns the worktree path and whether this call created it.
 */
export declare function addWorktree(exec: Exec, repoRoot: string, branch: string, targetPath: string, dirExists?: DirExists): Promise<{
    path: string;
    created: boolean;
}>;
/**
 * Plan a new branch name to cut out of `base`: `<base>-wt`, or the first
 * `-wt<N>` suffix not already taken (`main` → `main-wt`; if that exists,
 * `main-wt2`, …). One `for-each-ref` pass decides; the worktree folder
 * name derives from the returned name, so the caller should resolve it
 * BEFORE computing the target path. With `folderTaken` given, a name is
 * only free when its storage folder is free too: a leftover folder of a
 * since-deleted branch would otherwise fail `worktree add` with a bare
 * "already exists" — the suffix walk skips it the same way.
 * @param exec - executor seam.
 * @param repoRoot - main worktree directory.
 * @param base - base branch local name (or `HEAD` when detached).
 * @param folderTaken - storage-folder occupancy probe (branch name → taken).
 * @returns the free cutout branch name.
 */
export declare function cutoutBranchName(exec: Exec, repoRoot: string, base: string, folderTaken?: (branch: string) => boolean): Promise<string>;
/**
 * Create a worktree on a brand-new branch cut out of `base`: the base is
 * checked out by the main worktree (git forbids a second worktree on it),
 * so the new branch is created from it and checked out in the fresh
 * worktree instead.
 * @param exec - executor seam.
 * @param repoRoot - main worktree directory.
 * @param base - base branch local name (`main` or `HEAD`).
 * @param newBranch - the cutout branch name (see {@link cutoutBranchName}).
 * @param targetPath - absolute directory to create.
 */
export declare function addWorktreeCutout(exec: Exec, repoRoot: string, base: string, newBranch: string, targetPath: string): Promise<void>;
/**
 * In-place branch switch of the main checkout. A remote display name relies
 * on git's dwim: `git switch <local>` creates the tracking branch when
 * exactly one remote has it.
 * @param exec - executor seam.
 * @param repoRoot - main worktree directory.
 * @param branch - branch display name.
 * @returns the local branch name now checked out.
 */
export declare function switchBranch(exec: Exec, repoRoot: string, branch: string): Promise<string>;
/**
 * Create a NEW branch from the current checkout and check it out in place
 * (`git switch -c`): the cut point is whatever the queried directory's HEAD
 * points at, so a detached or unborn checkout cuts from the current commit
 * too. Runs at the queried directory's own toplevel — a session inside a
 * linked worktree creates and checks out within that worktree, never the
 * main checkout (the same semantics as {@link switchBranch}).
 * @param exec - executor seam.
 * @param cwd - directory whose HEAD the branch is cut from (worktree toplevel).
 * @param name - new branch name (git validates; failures raise GitError).
 * @returns the branch name now created and checked out.
 */
export declare function createBranch(exec: Exec, cwd: string, name: string): Promise<string>;
/**
 * Sync remote-tracking refs: fetch every remote and prune tracking branches
 * the remotes no longer carry (the CLI equivalent of IDEA's "synchronize
 * remote branches"). Pure metadata — the working tree, local branches, and
 * the current checkout are untouched; a slow network surfaces through the
 * executor's hard timeout as a GitError.
 * @param exec - executor seam.
 * @param repoRoot - main worktree directory (fetch is repository-wide).
 */
export declare function fetchAll(exec: Exec, repoRoot: string): Promise<void>;
/** Outcome of {@link updateBranch}: the branch touched and whether it moved. */
export interface UpdateOutcome {
    branch: string;
    updated: boolean;
}
/**
 * Update the CURRENT checkout: fetch every remote, then fast-forward the
 * branch checked out by `cwd` to its upstream (`@{u}`) — IDEA's "update
 * selected branch" in its default merge mode. Deliberately `--ff-only`:
 * a diverged local branch refuses rather than silently rebase/merge, and
 * uncommitted working-tree changes are git's own call to reject — the
 * plugin never stashes behind the user's back. Runs at the queried
 * directory's own toplevel, so a linked-worktree session updates the
 * branch ITS worktree holds.
 * @param exec - executor seam.
 * @param cwd - directory whose checked-out branch is updated.
 * @returns the branch name and whether HEAD actually moved (false = the
 * upstream already contained it).
 */
export declare function updateBranch(exec: Exec, cwd: string): Promise<UpdateOutcome>;
/** Guard for route inputs: a non-empty absolute directory path. */
export declare function isAbsoluteDir(value: string): boolean;
/** Pre-delete facts of one worktree directory, for the remove-confirm dialog. */
export interface WorktreeInspect {
    /** Uncommitted-change file rows (`git status --porcelain` line count). */
    dirty: number;
    /** Commits ahead of the branch's upstream; undefined when no upstream. */
    ahead: number | undefined;
}
/**
 * Inspect one worktree directory for removal: how many files carry
 * uncommitted changes (those ARE lost with the folder), and how many commits
 * the checked-out branch leads its upstream by (informational only — the
 * branch ref survives `worktree remove`, so those are kept).
 * @param exec - executor seam.
 * @param worktreePath - the worktree directory (absolute).
 */
export declare function inspectWorktree(exec: Exec, worktreePath: string): Promise<WorktreeInspect>;
/**
 * Remove one linked worktree: `git worktree remove` deletes the folder and
 * the registration in one stroke. A stale registration (folder already gone
 * behind git's back) resolves through `worktree prune` instead — the outcome
 * the user asked for either way, which keeps the route idempotent.
 * @param exec - executor seam.
 * @param repoRoot - main worktree directory.
 * @param worktreePath - the linked worktree directory to delete (absolute).
 * @param force - pass `--force` past uncommitted changes.
 * @param dirExists - existence seam for the stale-registration branch.
 * @returns the path plus whether only a stale registration was pruned.
 * @throws GitError for the main worktree, an unregistered path, or a refused
 * removal (git's own stderr verbatim).
 */
export declare function removeWorktree(exec: Exec, repoRoot: string, worktreePath: string, force: boolean, dirExists?: DirExists): Promise<{
    path: string;
    pruned: boolean;
}>;
/**
 * Lightweight git belonging probe for ONE workspace directory: the three
 * facts the sidebar grouping needs and nothing else (no branch list, no
 * worktree list — {@link probeRepo} stays the full-facts path for the chip).
 *
 * `repoRoot` — the grouping key — is derived from `--git-common-dir`, which
 * names the SHARED `<repo>/.git` from every worktree of the repository: the
 * main checkout reports it directly, a linked worktree reports the path back
 * to it. Both therefore resolve to the same repository root and group
 * together, wherever the linked folder physically lives.
 * `main` is decided without `worktree list`: a directory is the main worktree
 * exactly when its own toplevel holds that shared .git.
 * `branch` normalizes detached/unborn HEAD to null HERE so no consumer
 * downstream ever string-compares against git's synthetic `'HEAD'`.
 * @param exec - executor seam.
 * @param path - absolute directory the workspace reports.
 * @returns the facts, or undefined outside any git repository (a missing git
 * binary surfaces the same way — a non-zero exit through the seam).
 */
export declare function probeWorkspaceGit(exec: Exec, path: string): Promise<WorkspaceGitFacts | undefined>;
