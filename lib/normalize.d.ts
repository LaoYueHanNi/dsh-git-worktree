/**
 * Pure branch/path name normalization for worktree directory placement.
 * Windows-forbidden characters are the governing constraint: a worktree
 * folder name must survive on every platform the host runs on.
 */
/**
 * Turn a branch display name into a single safe directory segment.
 * `feat/auth-login` → `feat-auth-login`; every Windows-forbidden character
 * (`<>:"|?*`, control chars) and `/` become `-`; runs of separators (`-`,
 * `.`, whitespace — so a `//` or a git-illegal `..` collapses too) merge to
 * one `-`; a single interior `.` survives (`v1.2.3` stays readable); trailing
 * dots and spaces (Windows-forbidden suffixes) are stripped; the result is
 * clamped to 64 characters and never empty or dash-only.
 * @param branch - branch display name (local or `remote/name` form).
 * @returns a safe single path segment.
 */
export declare function sanitizeBranchDir(branch: string): string;
/**
 * Local branch name for a display name: strip the leading `<remote>/` segment
 * when one is present (`origin/feat/x` → `feat/x`). A local branch whose own
 * name contains `/` (like `feat/x`) passes through unchanged — callers that
 * need certainty compare against the authoritative branch list instead.
 * @param branch - branch display name.
 * @returns the candidate local branch name.
 */
export declare function localBranchName(branch: string): string;
/**
 * Split a `<remote>/<name>` display name when it plausibly names a remote
 * branch: the first `/`-separated segment is treated as the remote.
 * @param branch - branch display name.
 * @returns the remote part and the local-twin name, or undefined when the
 * name has no `/` (a local branch or a bare word).
 */
export declare function splitRemoteBranch(branch: string): {
    remote: string;
    name: string;
} | undefined;
/**
 * Validate a user-configured worktree storage root: an absolute path on any
 * platform (POSIX `/…`, Windows drive `C:\…`/`C:/…`, or UNC `\\…`).
 * @param value - raw settings string.
 * @returns true when the value names an absolute path.
 */
export declare function isAbsoluteConfigPath(value: string): boolean;
/** Why a user-typed NEW branch name is not acceptable yet (null = fine). */
export type BranchNameIssue = 'empty' | 'leadingDash' | 'illegal';
/**
 * Pre-flight check of a user-typed NEW branch name against git's ref-name
 * rules (git check-ref-format's reject list, the subset typing can hit):
 * non-empty; no leading `-` (git would parse it as a flag); no space, `~^:?*[\`
 * or control character; no `..`, `@{`, `//`, leading/trailing `/`; no component
 * starting with `.` or ending with `.lock`; no trailing `.`; not the lone `@`.
 * `git switch -c` stays the authority — a miss here surfaces through the
 * error envelope — this only feeds immediate form feedback.
 * @param name - raw draft text (NOT trimmed: a space is a real issue).
 * @returns the issue kind, or null when the name is acceptable.
 */
export declare function branchNameIssue(name: string): BranchNameIssue | null;
