/**
 * Git command wrapper for the host half. All git access goes through one
 * injectable `exec` seam (tests substitute it); every method is plain
 * argument assembly plus porcelain parsing, no ambient state.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, normalize, resolve } from 'node:path';
import { localBranchName } from './normalize.js';
/** Failure of one git invocation: non-zero exit with the stderr text. */
export class GitError extends Error {
    args;
    code;
    stderr;
    constructor(args, code, stderr) {
        super(`git ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`);
        this.args = args;
        this.code = code;
        this.stderr = stderr;
        this.name = 'GitError';
    }
}
/** Real executor over node:child_process with a hard timeout. */
export function childProcessExec(file, args, options) {
    return new Promise((resolvePromise) => {
        execFile(file, args, { cwd: options.cwd, encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
            // execFile reports any failure (non-zero exit, spawn error, timeout) as
            // a truthy error; the specific exit code never carries signal here —
            // stderr does — so every failure collapses to 1.
            resolvePromise({ code: error !== null ? 1 : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
        });
    });
}
/** Run one git command; a non-zero exit raises {@link GitError} with stderr. */
async function git(exec, cwd, args) {
    const result = await exec('git', args, { cwd });
    if (result.code !== 0)
        throw new GitError(args, result.code, result.stderr);
    return result.stdout;
}
/** Run one git command, mapping a non-zero exit to undefined instead of throwing. */
async function gitMaybe(exec, cwd, args) {
    const result = await exec('git', args, { cwd });
    return result.code === 0 ? result.stdout : undefined;
}
/** Real existence check. */
export const fsDirExists = path => existsSync(path);
/**
 * Resolve a directory to repository facts, or undefined outside any git
 * repository (including the `git` binary missing: ENOENT surfaces as a
 * non-zero exit through the seam).
 * @param exec - executor seam.
 * @param path - absolute directory the workspace reports.
 * @param dirExists - existence seam for stale-registration filtering.
 */
export async function probeRepo(exec, path, dirExists = fsDirExists) {
    const top = await gitMaybe(exec, path, ['rev-parse', '--show-toplevel']);
    if (top === undefined)
        return undefined;
    const commonDir = await gitMaybe(exec, path, ['rev-parse', '--git-common-dir']);
    // repoName comes from the shared .git location: a linked worktree's own
    // toplevel would name the branch folder, not the repository. Both git
    // outputs carry forward slashes on Windows — normalize every derived path.
    const repoRoot = normalize(top.trim());
    const gitDir = commonDir !== undefined && commonDir.trim() !== ''
        ? normalize(resolve(path, commonDir.trim()))
        : resolve(repoRoot, '.git');
    return {
        repoRoot,
        repoName: basename(dirname(gitDir)),
        currentBranch: await currentBranch(exec, path),
        branches: await listBranches(exec, repoRoot),
        // A stale registration (directory removed behind git's back) must not
        // reach the UI as a real worktree — it would disable branch rows for a
        // folder that no longer exists.
        worktrees: (await listWorktrees(exec, repoRoot)).filter(w => dirExists(w.path)),
    };
}
/** Currently checked-out branch of a directory; `HEAD` when detached or unborn. */
async function currentBranch(exec, cwd) {
    const name = await gitMaybe(exec, cwd, ['branch', '--show-current']);
    const trimmed = name?.trim() ?? '';
    return trimmed === '' ? 'HEAD' : trimmed;
}
/**
 * Local branches (each carrying its ahead/behind vs the upstream when one
 * exists) plus remote-only branches across EVERY remote (`<remote>/HEAD`
 * dropped).
 *
 * The upstream track comes from `%(upstream:track)`, which renders
 * `[ahead N, behind M]` (or a bare `[gone]`) directly after the refname —
 * `[` is illegal in refnames, so `indexOf('[')` splits name from track
 * without a separator. `[gone]` (upstream deleted server-side) carries no
 * counts and is dropped here; the UI renders no marker for it.
 */
async function listBranches(exec, repoRoot) {
    const localOut = await git(exec, repoRoot, ['for-each-ref', 'refs/heads', '--format=%(refname:short)%(upstream:track)']);
    const entries = [];
    for (const line of localOut.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '')
            continue;
        const bracket = trimmed.indexOf('[');
        const name = (bracket === -1 ? trimmed : trimmed.slice(0, bracket)).trim();
        if (name === '')
            continue;
        const track = bracket === -1 ? '' : trimmed.slice(bracket);
        const ahead = /\bahead (\d+)/.exec(track);
        const behind = /\bbehind (\d+)/.exec(track);
        const entry = { name, kind: 'local' };
        if (ahead !== null)
            entry.ahead = Number(ahead[1]);
        if (behind !== null)
            entry.behind = Number(behind[1]);
        entries.push(entry);
    }
    const remoteOut = await gitMaybe(exec, repoRoot, ['for-each-ref', 'refs/remotes', '--format=%(refname:short)']);
    if (remoteOut !== undefined) {
        // Local names as a Set: the twin lookup runs once per remote row, and a
        // linear scan over the assembled list would make the loop quadratic —
        // felt at thousand-branch repos, free to avoid.
        const localNames = new Set(entries.filter(e => e.kind === 'local').map(e => e.name));
        for (const line of remoteOut.split('\n')) {
            const name = line.trim();
            if (name === '')
                continue;
            const localName = localBranchName(name);
            // A bare ref directly under refs/remotes (shortname without `/`, like
            // a leftover `refs/remotes/origin`) is not a remote branch — git
            // branch -r hides it, the menu must not offer it either.
            if (localName === name)
                continue;
            // A remote branch with a local twin stays hidden: the twin is the
            // actionable row, showing both would duplicate it in the menu.
            if (localName === 'HEAD' || localNames.has(localName))
                continue;
            entries.push({ name, kind: 'remote' });
        }
    }
    return entries;
}
/** Parse `git worktree list --porcelain` into entries, main first. */
async function listWorktrees(exec, repoRoot) {
    const out = await git(exec, repoRoot, ['worktree', 'list', '--porcelain']);
    const entries = [];
    let path;
    let branch;
    let detached = false;
    const flush = () => {
        if (path === undefined)
            return;
        // Porcelain reports forward slashes on Windows; normalize so consumers
        // can compare against join()-built paths.
        entries.push({ path: normalize(path), branch: detached || branch === undefined ? undefined : branch.replace('refs/heads/', ''), main: entries.length === 0 });
        path = undefined;
        branch = undefined;
        detached = false;
    };
    for (const line of out.split('\n')) {
        if (line.startsWith('worktree ')) {
            flush();
            path = line.slice('worktree '.length).trim();
        }
        else if (line.startsWith('branch ')) {
            branch = line.slice('branch '.length).trim();
        }
        else if (line === 'detached') {
            detached = true;
        }
    }
    flush();
    return entries;
}
/**
 * Resolve a branch display name against the authoritative branch list of the
 * repository.
 * @returns the local name plus the tracking remote when the display name is
 * remote-only, or undefined when neither shape exists.
 */
async function resolveBranch(exec, repoRoot, branch) {
    const localsOut = await git(exec, repoRoot, ['for-each-ref', 'refs/heads', '--format=%(refname:short)']);
    const locals = localsOut.split('\n').map(l => l.trim()).filter(l => l !== '');
    if (locals.includes(branch))
        return { local: branch, remote: undefined };
    // A name without `/` can never name a remote branch — `<remote>/<name>`
    // always carries the slash. This guards the leftover bare `refs/remotes/<x>`
    // ref too: matching it would compute a garbage remote part.
    if (!branch.includes('/'))
        return undefined;
    const local = localBranchName(branch);
    if (local !== branch && locals.includes(local))
        return undefined; // the display names a remote, but the local twin exists: use the twin
    const remoteOut = await gitMaybe(exec, repoRoot, ['for-each-ref', 'refs/remotes', `refs/remotes/${branch}`, '--format=%(refname:short)']);
    if (remoteOut !== undefined && remoteOut.trim() !== '')
        return { local, remote: branch.slice(0, branch.length - local.length - 1) };
    return undefined;
}
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
export async function addWorktree(exec, repoRoot, branch, targetPath, dirExists = fsDirExists) {
    const resolved = await resolveBranch(exec, repoRoot, branch);
    if (resolved === undefined)
        throw new GitError(['worktree', 'add'], 1, `branch "${branch}" not found`);
    let worktrees = await listWorktrees(exec, repoRoot);
    const existing = worktrees.find(w => w.branch === resolved.local);
    if (existing !== undefined && dirExists(existing.path))
        return { path: existing.path, created: false };
    if (existing !== undefined) {
        // Stale registration: the directory is gone but git's administrative
        // record still claims the branch. Prune (git-side no-op when clean) and
        // re-read before creating, or `worktree add` would refuse the branch.
        await git(exec, repoRoot, ['worktree', 'prune']);
        worktrees = await listWorktrees(exec, repoRoot);
        const afterPrune = worktrees.find(w => w.branch === resolved.local);
        if (afterPrune !== undefined && dirExists(afterPrune.path))
            return { path: afterPrune.path, created: false };
    }
    if (resolved.remote === undefined) {
        await git(exec, repoRoot, ['worktree', 'add', targetPath, resolved.local]);
    }
    else {
        await git(exec, repoRoot, ['worktree', 'add', targetPath, '-b', resolved.local, branch]);
    }
    return { path: targetPath, created: true };
}
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
export async function cutoutBranchName(exec, repoRoot, base, folderTaken) {
    const out = await git(exec, repoRoot, ['for-each-ref', 'refs/heads', '--format=%(refname:short)']);
    const locals = new Set(out.split('\n').map(l => l.trim()).filter(l => l !== ''));
    // `base` is the checked-out branch (`branch --show-current` output), which
    // never carries a remote prefix — pass it through verbatim so a local name
    // containing '/' survives.
    const free = (candidate) => !locals.has(candidate) && !(folderTaken?.(candidate) ?? false);
    const stem = `${base}-wt`;
    if (free(stem))
        return stem;
    for (let i = 2;; i += 1) {
        const candidate = `${stem}${i}`;
        if (free(candidate))
            return candidate;
    }
}
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
export async function addWorktreeCutout(exec, repoRoot, base, newBranch, targetPath) {
    await git(exec, repoRoot, ['worktree', 'add', targetPath, '-b', newBranch, base]);
}
/**
 * In-place branch switch of the main checkout. A remote display name relies
 * on git's dwim: `git switch <local>` creates the tracking branch when
 * exactly one remote has it.
 * @param exec - executor seam.
 * @param repoRoot - main worktree directory.
 * @param branch - branch display name.
 * @returns the local branch name now checked out.
 */
export async function switchBranch(exec, repoRoot, branch) {
    const resolved = await resolveBranch(exec, repoRoot, branch);
    if (resolved === undefined)
        throw new GitError(['switch'], 1, `branch "${branch}" not found`);
    try {
        await git(exec, repoRoot, ['switch', resolved.local]);
    }
    catch (error) {
        // A stale worktree registration claims the branch; prune (no-op on a
        // healthy repo) and retry once — a live worktree still refuses, as it must.
        const stale = error instanceof GitError && error.stderr.includes('already used by worktree');
        if (!stale)
            throw error;
        await git(exec, repoRoot, ['worktree', 'prune']);
        await git(exec, repoRoot, ['switch', resolved.local]);
    }
    return resolved.local;
}
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
export async function createBranch(exec, cwd, name) {
    await git(exec, cwd, ['switch', '-c', name]);
    return name;
}
/**
 * Sync remote-tracking refs: fetch every remote and prune tracking branches
 * the remotes no longer carry (the CLI equivalent of IDEA's "synchronize
 * remote branches"). Pure metadata — the working tree, local branches, and
 * the current checkout are untouched; a slow network surfaces through the
 * executor's hard timeout as a GitError.
 * @param exec - executor seam.
 * @param repoRoot - main worktree directory (fetch is repository-wide).
 */
export async function fetchAll(exec, repoRoot) {
    await git(exec, repoRoot, ['fetch', '--all', '--prune']);
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
export async function updateBranch(exec, cwd) {
    await fetchAll(exec, cwd);
    const before = (await git(exec, cwd, ['rev-parse', 'HEAD'])).trim();
    await git(exec, cwd, ['merge', '--ff-only', '@{u}']);
    const after = (await git(exec, cwd, ['rev-parse', 'HEAD'])).trim();
    const branch = (await gitMaybe(exec, cwd, ['branch', '--show-current']))?.trim() ?? '';
    return { branch, updated: before !== after };
}
/** Guard for route inputs: a non-empty absolute directory path. */
export function isAbsoluteDir(value) {
    return value.trim() !== '' && isAbsolute(value);
}
