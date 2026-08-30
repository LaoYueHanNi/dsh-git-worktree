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
export function sanitizeBranchDir(branch) {
    const replaced = branch.replace(/[<>:"/\\|?*\u0000-\u001f\s]/g, '-');
    const merged = replaced.replace(/[-.]{2,}/g, '-');
    const trimmed = merged.replace(/[.\s-]+$/, '');
    const clamped = trimmed.slice(0, 64).replace(/[.\s-]+$/, '');
    return clamped === '' || clamped.replaceAll('-', '') === '' ? 'branch' : clamped;
}
/**
 * Local branch name for a display name: strip the leading `<remote>/` segment
 * when one is present (`origin/feat/x` → `feat/x`). A local branch whose own
 * name contains `/` (like `feat/x`) passes through unchanged — callers that
 * need certainty compare against the authoritative branch list instead.
 * @param branch - branch display name.
 * @returns the candidate local branch name.
 */
export function localBranchName(branch) {
    const at = branch.indexOf('/');
    return at <= 0 ? branch : branch.slice(at + 1);
}
/**
 * Split a `<remote>/<name>` display name when it plausibly names a remote
 * branch: the first `/`-separated segment is treated as the remote.
 * @param branch - branch display name.
 * @returns the remote part and the local-twin name, or undefined when the
 * name has no `/` (a local branch or a bare word).
 */
export function splitRemoteBranch(branch) {
    const at = branch.indexOf('/');
    if (at <= 0)
        return undefined;
    return { remote: branch.slice(0, at), name: branch.slice(at + 1) };
}
/**
 * Validate a user-configured worktree storage root: an absolute path on any
 * platform (POSIX `/…`, Windows drive `C:\…`/`C:/…`, or UNC `\\…`).
 * @param value - raw settings string.
 * @returns true when the value names an absolute path.
 */
export function isAbsoluteConfigPath(value) {
    if (value === '')
        return false;
    if (value.startsWith('/') || value.startsWith('\\'))
        return true;
    return /^[a-zA-Z]:[\\/]/.test(value);
}
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
export function branchNameIssue(name) {
    if (name.trim() === '')
        return 'empty';
    if (name.startsWith('-'))
        return 'leadingDash';
    if (name === '@')
        return 'illegal';
    if (/[\s~^:?*[\\\u0000-\u001f]/.test(name))
        return 'illegal';
    if (name.includes('..') || name.includes('@{') || name.includes('//'))
        return 'illegal';
    if (name.startsWith('/') || name.endsWith('/'))
        return 'illegal';
    if (name.endsWith('.'))
        return 'illegal';
    if (/(^|\/)\./.test(name))
        return 'illegal';
    if (/(^|\/)[^/]+\.lock($|\/)/.test(name))
        return 'illegal';
    return null;
}
