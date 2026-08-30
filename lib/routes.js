/**
 * Route logic as pure functions: query/body in, status+body out. The HTTP
 * shell (index.ts) owns req/res mechanics; everything testable lives here.
 */
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { GitError, addWorktree, addWorktreeCutout, createBranch, cutoutBranchName, fsDirExists, isAbsoluteDir, probeRepo, switchBranch } from './git.js';
import { isAbsoluteConfigPath, sanitizeBranchDir } from './normalize.js';
import { resolveRootDir } from './settings.js';
/** Uniform failure envelope. */
function fail(status, error) {
    return { status, body: { error } };
}
/** GitError to outcome: usage-shaped failures are 400, the rest 500. */
function gitFailure(error) {
    const usage = error.stderr.includes('usage:')
        || error.stderr.includes('fatal: invalid')
        // A user-typed branch name git refuses (`'bad..name' is not a valid
        // branch name`) is caller misuse, not a host fault — the client
        // pre-flights the same rules, this is the backstop.
        || error.stderr.includes('not a valid branch name');
    return fail(usage ? 400 : 500, error.message);
}
/**
 * GET /status 鈥?repository facts for one directory.
 * @param deps - host dependencies.
 * @param path - absolute directory the workspace reports.
 */
export async function handleStatus(deps, path) {
    if (path === undefined || !isAbsoluteDir(path))
        return fail(400, 'query parameter "path" must be an absolute directory');
    const facts = await probeRepo(deps.exec, path, deps.dirExists);
    const rootDir = resolveRootDir(deps.sectionRootDir(), deps.home(), deps.envHome());
    if (facts === undefined)
        return { status: 200, body: { repo: false } };
    return {
        status: 200,
        body: {
            repo: true,
            repoName: facts.repoName,
            repoRoot: facts.repoRoot,
            currentBranch: facts.currentBranch,
            branches: facts.branches,
            worktrees: facts.worktrees,
            rootDir,
        },
    };
}
/** Validate a JSON body object with exactly the expected keys. */
function readBody(body, keys, booleanKeys = []) {
    if (typeof body !== 'object' || body === null || Array.isArray(body))
        return fail(400, 'request body must be a JSON object');
    const record = body;
    for (const key of Object.keys(record)) {
        if (!keys.includes(key) && !booleanKeys.includes(key)) {
            return fail(400, `unknown body key "${key}"`);
        }
    }
    for (const key of keys) {
        if (typeof record[key] !== 'string')
            return fail(400, `body key "${key}" must be a string`);
    }
    for (const key of booleanKeys) {
        // Optional flag: absent stays absent (`cutout?: boolean`), present must type-check.
        if (record[key] !== undefined && typeof record[key] !== 'boolean') {
            return fail(400, `body key "${key}" must be a boolean`);
        }
    }
    return record;
}
/** Discriminator: a RouteOutcome carries the `status`/`body` pair no request body has. */
function isOutcome(value) {
    return typeof value === 'object' && value !== null && 'status' in value && 'body' in value;
}
/**
 * POST /worktree 鈥?create or reuse the worktree for a branch, then report the
 * directory so the client can register it as a workspace. With `cutout: true`
 * the branch is the CURRENT checkout (occupied by the main worktree, so git
 * refuses to add it): a new branch is cut out of it (`<branch>-wt`, first
 * free `-wt<N>` suffix) and isolated in the fresh worktree instead.
 * @param deps - host dependencies.
 * @param body - parsed request body.
 */
export async function handleCreateWorktree(deps, body) {
    const parsed = readBody(body, ['repoPath', 'branch'], ['cutout']);
    if (isOutcome(parsed))
        return parsed;
    const { repoPath, branch, cutout } = parsed;
    if (!isAbsoluteDir(repoPath))
        return fail(400, '"repoPath" must be an absolute directory');
    if (branch.trim() === '')
        return fail(400, '"branch" must be non-empty');
    const configured = deps.sectionRootDir()?.trim();
    if (configured !== undefined && configured !== '' && !isAbsoluteConfigPath(configured)) {
        return fail(400, `configured rootDir "${String(deps.sectionRootDir())}" is not an absolute path`);
    }
    try {
        const facts = await probeRepo(deps.exec, repoPath, deps.dirExists);
        if (facts === undefined)
            return fail(400, `"${repoPath}" is not inside a git repository`);
        const rootDir = resolveRootDir(deps.sectionRootDir(), deps.home(), deps.envHome());
        if (cutout === true) {
            // The new branch name must be known before the folder name can be
            // computed: the folder carries `<repoName>-<NEW branch>`. The name
            // must be free in BOTH namespaces — the branch table and the storage
            // folder: a leftover folder of a since-deleted branch would otherwise
            // fail `worktree add` with a bare "already exists", so the suffix
            // walk probes the folder too.
            const dirExists = deps.dirExists ?? fsDirExists;
            const newBranch = await cutoutBranchName(deps.exec, facts.repoRoot, branch, (candidate) => dirExists(join(rootDir, `${facts.repoName}-${sanitizeBranchDir(candidate)}`)));
            const target = join(rootDir, `${facts.repoName}-${sanitizeBranchDir(newBranch)}`);
            await mkdir(rootDir, { recursive: true });
            await addWorktreeCutout(deps.exec, facts.repoRoot, branch, newBranch, target);
            return { status: 200, body: { path: target, created: true } };
        }
        // The folder name carries the belonging itself: `<repoName>-<branch>` —
        // the sidebar group title (the folder basename) then reads as the parent
        // repository plus the branch instead of a bare branch word.
        const target = join(rootDir, `${facts.repoName}-${sanitizeBranchDir(branch)}`);
        await mkdir(rootDir, { recursive: true });
        const result = await addWorktree(deps.exec, facts.repoRoot, branch, target, deps.dirExists);
        return { status: 200, body: result };
    }
    catch (error) {
        if (error instanceof GitError)
            return gitFailure(error);
        return fail(500, error instanceof Error ? error.message : String(error));
    }
}
/**
 * POST /switch 鈥?in-place branch switch of the main checkout.
 * @param deps - host dependencies.
 * @param body - parsed request body.
 */
export async function handleSwitch(deps, body) {
    const parsed = readBody(body, ['repoPath', 'branch']);
    if (isOutcome(parsed))
        return parsed;
    const { repoPath, branch } = parsed;
    if (!isAbsoluteDir(repoPath))
        return fail(400, '"repoPath" must be an absolute directory');
    if (branch.trim() === '')
        return fail(400, '"branch" must be non-empty');
    try {
        const facts = await probeRepo(deps.exec, repoPath, deps.dirExists);
        if (facts === undefined)
            return fail(400, `"${repoPath}" is not inside a git repository`);
        const switched = await switchBranch(deps.exec, facts.repoRoot, branch);
        const result = { branch: switched };
        return { status: 200, body: result };
    }
    catch (error) {
        if (error instanceof GitError)
            return gitFailure(error);
        return fail(500, error instanceof Error ? error.message : String(error));
    }
}
/**
 * POST /branch 鈥?create a NEW branch from the queried directory's current
 * checkout (whatever its HEAD points at, detached included) and check it out
 * in place. Git validates the name; the client pre-flights the same rules
 * and only sends names it already accepts.
 * @param deps - host dependencies.
 * @param body - parsed request body.
 */
export async function handleCreateBranch(deps, body) {
    const parsed = readBody(body, ['repoPath', 'name']);
    if (isOutcome(parsed))
        return parsed;
    const { repoPath, name } = parsed;
    if (!isAbsoluteDir(repoPath))
        return fail(400, '"repoPath" must be an absolute directory');
    if (name.trim() === '')
        return fail(400, '"name" must be non-empty');
    // A leading dash would ride `git switch -c` as a flag — reject before the
    // exec, not as an "unknown switch" GitError.
    if (name.startsWith('-'))
        return fail(400, '"name" must not start with "-"');
    try {
        const facts = await probeRepo(deps.exec, repoPath, deps.dirExists);
        if (facts === undefined)
            return fail(400, `"${repoPath}" is not inside a git repository`);
        const created = await createBranch(deps.exec, facts.repoRoot, name);
        const result = { branch: created };
        return { status: 200, body: result };
    }
    catch (error) {
        if (error instanceof GitError)
            return gitFailure(error);
        return fail(500, error instanceof Error ? error.message : String(error));
    }
}
