/**
 * Route logic as pure functions: query/body in, status+body out. The HTTP
 * shell (index.ts) owns req/res mechanics; everything testable lives here.
 */
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { GitError, addWorktree, isAbsoluteDir, probeRepo, switchBranch } from './git.js';
import { isAbsoluteConfigPath, sanitizeBranchDir } from './normalize.js';
import { resolveRootDir } from './settings.js';
/** Uniform failure envelope. */
function fail(status, error) {
    return { status, body: { error } };
}
/** GitError to outcome: usage-shaped failures are 400, the rest 500. */
function gitFailure(error) {
    const usage = error.stderr.includes('usage:') || error.stderr.includes('fatal: invalid');
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
function readBody(body, keys) {
    if (typeof body !== 'object' || body === null || Array.isArray(body))
        return fail(400, 'request body must be a JSON object');
    const record = body;
    for (const key of Object.keys(record)) {
        if (!keys.includes(key))
            return fail(400, `unknown body key "${key}"`);
    }
    for (const key of keys) {
        if (typeof record[key] !== 'string')
            return fail(400, `body key "${key}" must be a string`);
    }
    return record;
}
/** Discriminator: a RouteOutcome carries the `status`/`body` pair no request body has. */
function isOutcome(value) {
    return typeof value === 'object' && value !== null && 'status' in value && 'body' in value;
}
/**
 * POST /worktree 鈥?create or reuse the worktree for a branch, then report the
 * directory so the client can register it as a workspace.
 * @param deps - host dependencies.
 * @param body - parsed request body.
 */
export async function handleCreateWorktree(deps, body) {
    const parsed = readBody(body, ['repoPath', 'branch']);
    if (isOutcome(parsed))
        return parsed;
    const { repoPath, branch } = parsed;
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
