/**
 * Git command wrapper for the host half. All git access goes through one
 * injectable `exec` seam (tests substitute it); every method is plain
 * argument assembly plus porcelain parsing, no ambient state.
 */
import type { BranchEntry, WorktreeEntry } from './wire.js';
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
 * In-place branch switch of the main checkout. A remote display name relies
 * on git's dwim: `git switch <local>` creates the tracking branch when
 * exactly one remote has it.
 * @param exec - executor seam.
 * @param repoRoot - main worktree directory.
 * @param branch - branch display name.
 * @returns the local branch name now checked out.
 */
export declare function switchBranch(exec: Exec, repoRoot: string, branch: string): Promise<string>;
/** Guard for route inputs: a non-empty absolute directory path. */
export declare function isAbsoluteDir(value: string): boolean;
