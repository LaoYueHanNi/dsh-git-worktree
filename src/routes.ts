/**
 * Route logic as pure functions: query/body in, status+body out. The HTTP
 * shell (index.ts) owns req/res mechanics; everything testable lives here.
 */

import { dirname, join, resolve } from 'node:path'
import { mkdir, stat } from 'node:fs/promises'
import { GitError, addWorktree, addWorktreeCutout, createBranch, cutoutBranchName, fetchAll, fsDirExists, inspectWorktree, isAbsoluteDir, probeRepo, probeWorkspaceGit, removeWorktree, switchBranch, updateBranch, type DirExists, type Exec } from './git.js'
import { isAbsoluteConfigPath, sanitizeBranchDir } from './normalize.js'
import { resolveRootDir } from './settings.js'
import type {
  CreateBranchBody, CreateBranchResult, CreateWorktreeBody, CreateWorktreeResult, EnsureDirectoryBody, EnsureDirectoryResult, FetchBody, FetchResult, GroupWorkspacesResult, InspectWorktreeBody, InspectWorktreeResult, PathExistsResult, RemoveWorktreeBody, RemoveWorktreeResult, RepoStatus, RouteError, SwitchBody, SwitchResult, UpdateBody, UpdateResult,
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
  /** Directory probe seam over fs.stat (true = exists AND is a directory);
   * tests substitute. */
  statDirectory?: (path: string) => Promise<boolean>
  /** Recursive mkdir seam (fs.mkdir recursive); tests substitute. */
  mkdirRecursive?: (path: string) => Promise<void>
}

/** Real fs-backed directory probe: exists and is a directory. */
export async function fsStatDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Real fs-backed recursive mkdir. */
export async function fsMkdirRecursive(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

/** One route outcome: HTTP status plus the JSON body. */
export interface RouteOutcome {
  status: number
  body: RepoStatus | CreateWorktreeResult | SwitchResult | CreateBranchResult | FetchResult | UpdateResult | GroupWorkspacesResult | InspectWorktreeResult | RemoveWorktreeResult | PathExistsResult | EnsureDirectoryResult | RouteError
}

/** Uniform failure envelope. */
function fail(status: number, error: string): RouteOutcome {
  return { status, body: { error } }
}

/** Upper bound on distinct paths one /group request may probe. */
const GROUP_PATHS_LIMIT = 256

/** Probes per in-flight batch — polite on Windows, where each git call is a
 * process spawn. The probe itself is a single `rev-parse` per directory, so
 * the batch can ride wider than the old three-spawn shape without stacking
 * an unreasonable number of concurrent git processes. */
const GROUP_BATCH_SIZE = 16

/**
 * POST /group — git belonging facts for a batch of workspace directories.
 * Deduplicates, validates, probes in bounded batches, and answers 200 with
 * per-path facts (null for non-repositories); a repository-wide git failure
 * is a per-path null, never a 500 — the sidebar must degrade to flat, not
 * error out.
 * @param deps - host dependencies.
 * @param body - parsed request body: `{ paths }`.
 */
export async function handleGroupWorktrees(deps: RouteDeps, body: unknown): Promise<RouteOutcome> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail(400, 'request body must be a JSON object')
  const paths = (body as Record<string, unknown>).paths
  if (!Array.isArray(paths)) return fail(400, 'body key "paths" must be an array of absolute directories')
  const unknownKeys = Object.keys(body as Record<string, unknown>).filter(key => key !== 'paths')
  if (unknownKeys.length > 0) return fail(400, `unknown body key "${unknownKeys[0]}"`)
  const distinct: string[] = []
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || !isAbsoluteDir(candidate)) return fail(400, 'body key "paths" must be an array of absolute directories')
    if (!distinct.includes(candidate)) distinct.push(candidate)
  }
  if (distinct.length > GROUP_PATHS_LIMIT) return fail(400, `body key "paths" accepts at most ${String(GROUP_PATHS_LIMIT)} distinct directories`)

  const facts: Record<string, GroupWorkspacesResult['facts'][string]> = {}
  for (let start = 0; start < distinct.length; start += GROUP_BATCH_SIZE) {
    const batch = distinct.slice(start, start + GROUP_BATCH_SIZE)
    const probed = await Promise.all(batch.map(async (path) => {
      // A probe never throws here by contract (gitMaybe folds non-zero exits),
      // but a defensive catch keeps ONE bad path from sinking the batch.
      try {
        return [path, await probeWorkspaceGit(deps.exec, path) ?? null] as const
      } catch {
        return [path, null] as const
      }
    }))
    for (const [path, value] of probed) facts[path] = value
  }
  return { status: 200, body: { facts } }
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
    // Removal refusals from git.ts are caller-side state the same way: the
    // main worktree (git refuses it too, but the route answers a clean 400
    // before ever spawning git) and a path the repository never registered
    // (a stale sidebar row racing a terminal-side removal).
    || error.stderr.includes('cannot remove the main worktree')
    || error.stderr.includes('is not a registered worktree')
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

/**
 * POST /inspect — pre-delete facts for one worktree directory: the
 * uncommitted-file count (those die with the folder) and the checked-out
 * branch's ahead count (kept — the branch ref survives the removal).
 * Deliberately repo-wide neutral: any directory inside a repository answers,
 * so the dialog data stays meaningful even for odd shapes.
 * @param deps - host dependencies.
 * @param body - parsed request body: `{ path }`.
 */
export async function handleInspectWorktree(deps: RouteDeps, body: unknown): Promise<RouteOutcome> {
  const parsed = readBody<InspectWorktreeBody>(body, ['path'])
  if (isOutcome(parsed)) return parsed
  const { path } = parsed
  if (!isAbsoluteDir(path)) return fail(400, '"path" must be an absolute directory')
  try {
    const facts = await probeRepo(deps.exec, path, deps.dirExists)
    if (facts === undefined) return fail(400, `"${path}" is not inside a git repository`)
    const inspected = await inspectWorktree(deps.exec, path)
    const result: InspectWorktreeResult = { dirty: inspected.dirty, ...inspected.ahead === undefined ? {} : { ahead: inspected.ahead } }
    return { status: 200, body: result }
  } catch (error) {
    if (error instanceof GitError) return gitFailure(error)
    return fail(500, error instanceof Error ? error.message : String(error))
  }
}

/**
 * POST /remove — delete one linked worktree: git's registration plus the
 * folder in one stroke (`worktree remove`, `--force` past uncommitted
 * changes the dialog already showed). DSH-side cleanup (archiving the
 * workspace's sessions, dropping the workspace registration) is the
 * browser's follow-up, by design: git first, so a refused removal leaves
 * the workspace world untouched.
 * @param deps - host dependencies.
 * @param body - parsed request body: `{ path, force? }`.
 */
export async function handleRemoveWorktree(deps: RouteDeps, body: unknown): Promise<RouteOutcome> {
  const parsed = readBody<RemoveWorktreeBody>(body, ['path'], ['force'])
  if (isOutcome(parsed)) return parsed
  const { path, force } = parsed
  if (!isAbsoluteDir(path)) return fail(400, '"path" must be an absolute directory')
  try {
    const facts = await probeRepo(deps.exec, path, deps.dirExists)
    if (facts === undefined) return fail(400, `"${path}" is not inside a git repository`)
    const result = await removeWorktree(deps.exec, facts.repoRoot, path, force === true, deps.dirExists)
    return { status: 200, body: result }
  } catch (error) {
    if (error instanceof GitError) return gitFailure(error)
    return fail(500, error instanceof Error ? error.message : String(error))
  }
}

/**
 * POST /exists — batch directory-existence probe over plain fs (no git): true
 * per path that exists AND is a directory. The browser gates the
 * register-as-workspace action on this, so a missing folder (deleted, moved,
 * or a corrupted session-header cwd) is answered by THIS route — the DSH
 * workspace API never sees an unregistrable path.
 * @param deps - host dependencies.
 * @param body - parsed request body: `{ paths }`.
 */
export async function handlePathExists(deps: RouteDeps, body: unknown): Promise<RouteOutcome> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail(400, 'request body must be a JSON object')
  const paths = (body as Record<string, unknown>).paths
  if (!Array.isArray(paths)) return fail(400, 'body key "paths" must be an array of absolute directories')
  const unknownKeys = Object.keys(body as Record<string, unknown>).filter(key => key !== 'paths')
  if (unknownKeys.length > 0) return fail(400, `unknown body key "${unknownKeys[0]}"`)
  const distinct: string[] = []
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || !isAbsoluteDir(candidate)) return fail(400, 'body key "paths" must be an array of absolute directories')
    if (!distinct.includes(candidate)) distinct.push(candidate)
  }
  if (distinct.length > GROUP_PATHS_LIMIT) return fail(400, `body key "paths" accepts at most ${String(GROUP_PATHS_LIMIT)} distinct directories`)
  const statDirectory = deps.statDirectory ?? fsStatDirectory
  const exists: PathExistsResult['exists'] = {}
  await Promise.all(distinct.map(async (path) => {
    // One bad path must not sink the batch: a probe that throws reads as
    // "not a directory" — exactly the gating answer the client needs.
    exists[path] = await statDirectory(path).catch(() => false)
  }))
  // Rebuildability is a STORAGE-SLOT fact, not a general one: only a missing
  // path sitting DIRECTLY inside the resolved worktree root is a slot this
  // plugin planned, so recreating the empty directory is safe self-healing
  // (its sessions reattach by realpath once the folder is back). Paths
  // outside the root are the user's own territory — never rebuilt here.
  const rootDir = resolveRootDir(deps.sectionRootDir(), deps.home(), deps.envHome())
  const rebuildable: PathExistsResult['rebuildable'] = {}
  for (const path of distinct) {
    if (exists[path]) continue
    rebuildable[path] = dirname(resolve(path)) === resolve(rootDir)
  }
  return { status: 200, body: { exists, ...Object.values(rebuildable).some(Boolean) ? { rebuildable } : {} } }
}

/**
 * POST /ensure-directory — recreate a MISSING worktree storage slot
 * (`mkdir -p`). Strictly gated to paths sitting DIRECTLY inside the resolved
 * worktree storage root: those slots were planned and created by this plugin,
 * so rebuilding the empty folder is self-healing (historical sessions
 * reattach automatically once realpath matches again — DSH keeps the
 * workspace accounting and filters membership by the session header's cwd).
 * Anything else is outside this plugin's territory and is refused, so a
 * corrupted session-header cwd can never be materialized as stray folders.
 * @param deps - host dependencies.
 * @param body - parsed request body: `{ path }`.
 */
export async function handleEnsureDirectory(deps: RouteDeps, body: unknown): Promise<RouteOutcome> {
  const parsed = readBody<EnsureDirectoryBody>(body, ['path'])
  if (isOutcome(parsed)) return parsed
  const { path } = parsed
  if (!isAbsoluteDir(path)) return fail(400, '"path" must be an absolute directory')
  const configured = deps.sectionRootDir()?.trim()
  if (configured !== undefined && configured !== '' && !isAbsoluteConfigPath(configured)) {
    return fail(400, `configured rootDir "${String(deps.sectionRootDir())}" is not an absolute path`)
  }
  const rootDir = resolveRootDir(deps.sectionRootDir(), deps.home(), deps.envHome())
  const canonical = resolve(path)
  // Exactly one level below the root, compared on resolved forms so `..`
  // and spelling drift cannot escape the slot boundary.
  if (dirname(canonical) !== resolve(rootDir)) {
    return fail(400, `"${canonical}" is outside the worktree storage root "${resolve(rootDir)}"`)
  }
  const mkdirRecursive = deps.mkdirRecursive ?? fsMkdirRecursive
  try {
    const statDirectory = deps.statDirectory ?? fsStatDirectory
    if (await statDirectory(canonical)) return { status: 200, body: { created: true } }
    await mkdirRecursive(canonical)
    return { status: 200, body: { created: true } }
  } catch (error) {
    return fail(500, error instanceof Error ? error.message : String(error))
  }
}
