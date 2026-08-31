/**
 * Route logic as pure functions: query/body in, status+body out. The HTTP
 * shell (index.ts) owns req/res mechanics; everything testable lives here.
 */

import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { GitError, addWorktree, addWorktreeCutout, createBranch, cutoutBranchName, fetchAll, fsDirExists, isAbsoluteDir, probeRepo, switchBranch, updateBranch, type DirExists, type Exec } from './git.js'
import { isAbsoluteConfigPath, sanitizeBranchDir } from './normalize.js'
import { resolveRootDir } from './settings.js'
import type {
  CreateBranchBody, CreateBranchResult, CreateWorktreeBody, CreateWorktreeResult, FetchBody, FetchResult, RepoStatus, RouteError, SwitchBody, SwitchResult, UpdateBody, UpdateResult,
} from './wire.js'

/** Everything the handlers need from the host half. */
export interface RouteDeps {
  exec: Exec
  /** The settings-resolved rootDir (absent/blank = the default location). */
  sectionRootDir: () => string | undefined
  /** User home directory seam. */
  home: () => string
  /** `$DSH_HOME` environment value seam. */
  envHome: () => string | undefined
  /** Worktree-registration existence seam (tests substitute). */
  dirExists?: DirExists
}

/** One route outcome: HTTP status plus the JSON body. */
export interface RouteOutcome {
  status: number
  body: RepoStatus | CreateWorktreeResult | SwitchResult | CreateBranchResult | FetchResult | UpdateResult | RouteError
}

/** Uniform failure envelope. */
function fail(status: number, error: string): RouteOutcome {
  return { status, body: { error } }
}

/** GitError to outcome: usage-shaped failures are 400, the rest 500. */
function gitFailure(error: GitError): RouteOutcome {
  const usage = error.stderr.includes('usage:')
    || error.stderr.includes('fatal: invalid')
    // A user-typed branch name git refuses (`'bad..name' is not a valid
    // branch name`) is caller misuse, not a host fault — the client
    // pre-flights the same rules, this is the backstop.
    || error.stderr.includes('not a valid branch name')
    // A name or storage folder that already exists is caller misuse too
    // (a stale worktree folder survives its branch's deletion): the client
    // pre-flights branch duplicates, this is the backstop.
    || error.stderr.includes('already exists')
    // Diverged/branchless states an update cannot fast-forward through are
    // the user's repo state, not host faults: no upstream to merge, a
    // detached HEAD, or local commits `--ff-only` must not paper over.
    || error.stderr.includes('Not possible to fast-forward')
    || error.stderr.includes('no tracking information')
    || error.stderr.includes("unknown revision")
    // A display name that resolves to no branch at all (a stale row the
    // menu no longer shows) is caller-side state, not a host fault. The
    // failure is the SYNTHETIC GitError from git.ts (`branch "x" not
    // found`), so match its `branch "` shape — git's own "not found"
    // texts (a remote that vanished mid-fetch: `Repository '...' not
    // found`) carry no quoted branch and stay 500 host faults.
    || error.stderr.includes('branch "')
  return fail(usage ? 400 : 500, error.message)
}

/**
 * GET /status 鈥?repository facts for one directory.
 * @param deps - host dependencies.
 * @param path - absolute directory the workspace reports.
 */
export async function handleStatus(deps: RouteDeps, path: string | undefined): Promise<RouteOutcome> {
  if (path === undefined || !isAbsoluteDir(path)) return fail(400, 'query parameter "path" must be an absolute directory')
  const facts = await probeRepo(deps.exec, path, deps.dirExists)
  const rootDir = resolveRootDir(deps.sectionRootDir(), deps.home(), deps.envHome())
  if (facts === undefined) return { status: 200, body: { repo: false } }
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
  }
}

/** Validate a JSON body object with exactly the expected keys. */
function readBody<T>(
  body: unknown,
  keys: readonly (keyof T & string)[],
  booleanKeys: readonly (keyof T & string)[] = [],
  optionalKeys: readonly (keyof T & string)[] = [],
): T | RouteOutcome {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail(400, 'request body must be a JSON object')
  const record = body as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!keys.includes(key as keyof T & string) && !booleanKeys.includes(key as keyof T & string) && !optionalKeys.includes(key as keyof T & string)) {
      return fail(400, `unknown body key "${key}"`)
    }
  }
  for (const key of keys) {
    if (typeof record[key] !== 'string') return fail(400, `body key "${key}" must be a string`)
  }
  for (const key of booleanKeys) {
    // Optional flag: absent stays absent (`cutout?: boolean`), present must type-check.
    if (record[key] !== undefined && typeof record[key] !== 'boolean') {
      return fail(400, `body key "${key}" must be a boolean`)
    }
  }
  for (const key of optionalKeys) {
    // Optional string: absent stays absent (`name?: string`), present must type-check.
    if (record[key] !== undefined && typeof record[key] !== 'string') {
      return fail(400, `body key "${key}" must be a string`)
    }
  }
  return record as T
}

/** Discriminator: a RouteOutcome carries the `status`/`body` pair no request body has. */
function isOutcome(value: unknown): value is RouteOutcome {
  return typeof value === 'object' && value !== null && 'status' in value && 'body' in value
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
export async function handleCreateWorktree(deps: RouteDeps, body: unknown): Promise<RouteOutcome> {
  const parsed = readBody<CreateWorktreeBody>(body, ['repoPath', 'branch'], ['cutout'], ['name'])
  if (isOutcome(parsed)) return parsed
  const { repoPath, branch, cutout, name } = parsed
  if (!isAbsoluteDir(repoPath)) return fail(400, '"repoPath" must be an absolute directory')
  if (branch.trim() === '') return fail(400, '"branch" must be non-empty')
  const configured = deps.sectionRootDir()?.trim()
  if (configured !== undefined && configured !== '' && !isAbsoluteConfigPath(configured)) {
    return fail(400, `configured rootDir "${String(deps.sectionRootDir())}" is not an absolute path`)
  }
  try {
    const facts = await probeRepo(deps.exec, repoPath, deps.dirExists)
    if (facts === undefined) return fail(400, `"${repoPath}" is not inside a git repository`)
    const rootDir = resolveRootDir(deps.sectionRootDir(), deps.home(), deps.envHome())
    if (cutout === true) {
      // An explicit name skips the `-wt` suffix walk and is used verbatim —
      // both for the branch and the storage folder. A leading dash would
      // ride `worktree add -b` as a flag; any other git-invalid name
      // surfaces through the error envelope (the client pre-flights).
      const custom = name?.trim()
      if (custom !== undefined && custom !== '') {
        if (custom.startsWith('-')) return fail(400, '"name" must not start with "-"')
        const target = join(rootDir, `${facts.repoName}-${sanitizeBranchDir(custom)}`)
        await mkdir(rootDir, { recursive: true })
        await addWorktreeCutout(deps.exec, facts.repoRoot, branch, custom, target)
        return { status: 200, body: { path: target, created: true } }
      }
      // The new branch name must be known before the folder name can be
      // computed: the folder carries `<repoName>-<NEW branch>`. The name
      // must be free in BOTH namespaces — the branch table and the storage
      // folder: a leftover folder of a since-deleted branch would otherwise
      // fail `worktree add` with a bare "already exists", so the suffix
      // walk probes the folder too.
      const dirExists = deps.dirExists ?? fsDirExists
      const newBranch = await cutoutBranchName(deps.exec, facts.repoRoot, branch, (candidate) =>
        dirExists(join(rootDir, `${facts.repoName}-${sanitizeBranchDir(candidate)}`)),
      )
      const target = join(rootDir, `${facts.repoName}-${sanitizeBranchDir(newBranch)}`)
      await mkdir(rootDir, { recursive: true })
      await addWorktreeCutout(deps.exec, facts.repoRoot, branch, newBranch, target)
      return { status: 200, body: { path: target, created: true } }
    }
    // The folder name carries the belonging itself: `<repoName>-<branch>` —
    // the sidebar group title (the folder basename) then reads as the parent
    // repository plus the branch instead of a bare branch word.
    const target = join(rootDir, `${facts.repoName}-${sanitizeBranchDir(branch)}`)
    await mkdir(rootDir, { recursive: true })
    const result = await addWorktree(deps.exec, facts.repoRoot, branch, target, deps.dirExists)
    return { status: 200, body: result }
  } catch (error) {
    if (error instanceof GitError) return gitFailure(error)
    return fail(500, error instanceof Error ? error.message : String(error))
  }
}

/**
 * POST /switch 鈥?in-place branch switch of the main checkout.
 * @param deps - host dependencies.
 * @param body - parsed request body.
 */
export async function handleSwitch(deps: RouteDeps, body: unknown): Promise<RouteOutcome> {
  const parsed = readBody<SwitchBody>(body, ['repoPath', 'branch'])
  if (isOutcome(parsed)) return parsed
  const { repoPath, branch } = parsed
  if (!isAbsoluteDir(repoPath)) return fail(400, '"repoPath" must be an absolute directory')
  if (branch.trim() === '') return fail(400, '"branch" must be non-empty')
  try {
    const facts = await probeRepo(deps.exec, repoPath, deps.dirExists)
    if (facts === undefined) return fail(400, `"${repoPath}" is not inside a git repository`)
    const switched = await switchBranch(deps.exec, facts.repoRoot, branch)
    const result: SwitchResult = { branch: switched }
    return { status: 200, body: result }
  } catch (error) {
    if (error instanceof GitError) return gitFailure(error)
    return fail(500, error instanceof Error ? error.message : String(error))
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
export async function handleCreateBranch(deps: RouteDeps, body: unknown): Promise<RouteOutcome> {
  const parsed = readBody<CreateBranchBody>(body, ['repoPath', 'name'])
  if (isOutcome(parsed)) return parsed
  const { repoPath, name } = parsed
  if (!isAbsoluteDir(repoPath)) return fail(400, '"repoPath" must be an absolute directory')
  if (name.trim() === '') return fail(400, '"name" must be non-empty')
  // A leading dash would ride `git switch -c` as a flag — reject before the
  // exec, not as an "unknown switch" GitError.
  if (name.startsWith('-')) return fail(400, '"name" must not start with "-"')
  try {
    const facts = await probeRepo(deps.exec, repoPath, deps.dirExists)
    if (facts === undefined) return fail(400, `"${repoPath}" is not inside a git repository`)
    const created = await createBranch(deps.exec, facts.repoRoot, name)
    const result: CreateBranchResult = { branch: created }
    return { status: 200, body: result }
  } catch (error) {
    if (error instanceof GitError) return gitFailure(error)
    return fail(500, error instanceof Error ? error.message : String(error))
  }
}

/**
 * POST /fetch 鈥?sync remote-tracking refs for the repository: fetch every
 * remote and prune tracking branches the remotes no longer carry. Pure
 * metadata — the working tree and the current checkout are untouched; the
 * client refetches /status afterwards for the fresh branch list.
 * @param deps - host dependencies.
 * @param body - parsed request body.
 */
export async function handleFetch(deps: RouteDeps, body: unknown): Promise<RouteOutcome> {
  const parsed = readBody<FetchBody>(body, ['repoPath'])
  if (isOutcome(parsed)) return parsed
  const { repoPath } = parsed
  if (!isAbsoluteDir(repoPath)) return fail(400, '"repoPath" must be an absolute directory')
  try {
    const facts = await probeRepo(deps.exec, repoPath, deps.dirExists)
    if (facts === undefined) return fail(400, `"${repoPath}" is not inside a git repository`)
    await fetchAll(deps.exec, facts.repoRoot)
    const result: FetchResult = { remote: 'all' }
    return { status: 200, body: result }
  } catch (error) {
    if (error instanceof GitError) return gitFailure(error)
    return fail(500, error instanceof Error ? error.message : String(error))
  }
}

/**
 * POST /update 鈥?update the CURRENT checkout: fetch every remote, then
 * fast-forward the branch checked out by the queried directory to its
 * upstream. Divergence, a missing upstream, and conflicting working-tree
 * changes all surface as 400 envelopes carrying git's own explanation.
 * @param deps - host dependencies.
 * @param body - parsed request body.
 */
export async function handleUpdate(deps: RouteDeps, body: unknown): Promise<RouteOutcome> {
  const parsed = readBody<UpdateBody>(body, ['repoPath'])
  if (isOutcome(parsed)) return parsed
  const { repoPath } = parsed
  if (!isAbsoluteDir(repoPath)) return fail(400, '"repoPath" must be an absolute directory')
  try {
    const facts = await probeRepo(deps.exec, repoPath, deps.dirExists)
    if (facts === undefined) return fail(400, `"${repoPath}" is not inside a git repository`)
    const outcome = await updateBranch(deps.exec, facts.repoRoot)
    const result: UpdateResult = { branch: outcome.branch, updated: outcome.updated }
    return { status: 200, body: result }
  } catch (error) {
    if (error instanceof GitError) return gitFailure(error)
    return fail(500, error instanceof Error ? error.message : String(error))
  }
}
