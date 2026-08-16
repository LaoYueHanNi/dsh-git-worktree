/**
 * Route logic as pure functions: query/body in, status+body out. The HTTP
 * shell (index.ts) owns req/res mechanics; everything testable lives here.
 */

import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { GitError, addWorktree, fsDirExists, isAbsoluteDir, probeRepo, switchBranch, type DirExists, type Exec } from './git.js'
import { isAbsoluteConfigPath, sanitizeBranchDir } from './normalize.js'
import { loadSettings, resolveRootDir, saveSettings, type StoredSettings } from './settings.js'
import type {
  CreateWorktreeBody, CreateWorktreeResult, RepoStatus, RouteError, SettingsBody, SwitchBody, SwitchResult,
} from './wire.js'

/** Everything the handlers need from the host half. */
export interface RouteDeps {
  exec: Exec
  /** Absolute settings file path (the persisted document). */
  settingsFile: string
  /** In-memory cached settings; the file is authoritative across restarts. */
  cachedSettings: () => StoredSettings
  /** Persist and advance the cache (throws on an invalid value). */
  storeSettings: (value: StoredSettings) => Promise<void>
  /** User home directory seam. */
  home: () => string
  /** Worktree-registration existence seam (tests substitute). */
  dirExists?: DirExists
}

/** One route outcome: HTTP status plus the JSON body. */
export interface RouteOutcome {
  status: number
  body: RepoStatus | CreateWorktreeResult | SwitchResult | SettingsBody | RouteError
}

/** Uniform failure envelope. */
function fail(status: number, error: string): RouteOutcome {
  return { status, body: { error } }
}

/** GET /settings 鈥?the persisted document. */
export async function handleGetSettings(deps: RouteDeps): Promise<RouteOutcome> {
  const value = await loadSettings(deps.settingsFile)
  return { status: 200, body: { rootDir: value.rootDir } }
}

/** PUT /settings 鈥?validate, persist, and advance the cache. */
export async function handlePutSettings(deps: RouteDeps, body: unknown): Promise<RouteOutcome> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(400, 'request body must be a JSON object')
  }
  const record = body as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key !== 'rootDir') return fail(400, `unknown body key "${key}"`)
  }
  if (typeof record.rootDir !== 'string') return fail(400, 'body key "rootDir" must be a string')
  try {
    await saveSettings(deps.settingsFile, { rootDir: record.rootDir })
    await deps.storeSettings({ rootDir: record.rootDir.trim() })
    return { status: 200, body: { rootDir: record.rootDir.trim() } }
  } catch (error) {
    return fail(400, error instanceof Error ? error.message : String(error))
  }
}

/** GitError to outcome: usage-shaped failures are 400, the rest 500. */
function gitFailure(error: GitError): RouteOutcome {
  const usage = error.stderr.includes('usage:') || error.stderr.includes('fatal: invalid')
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
  const rootDir = resolveRootDir(deps.cachedSettings(), deps.home())
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
function readBody<T>(body: unknown, keys: readonly (keyof T & string)[]): T | RouteOutcome {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail(400, 'request body must be a JSON object')
  const record = body as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!keys.includes(key as keyof T & string)) return fail(400, `unknown body key "${key}"`)
  }
  for (const key of keys) {
    if (typeof record[key] !== 'string') return fail(400, `body key "${key}" must be a string`)
  }
  return record as T
}

/** Discriminator: a RouteOutcome carries the `status`/`body` pair no request body has. */
function isOutcome(value: unknown): value is RouteOutcome {
  return typeof value === 'object' && value !== null && 'status' in value && 'body' in value
}

/**
 * POST /worktree 鈥?create or reuse the worktree for a branch, then report the
 * directory so the client can register it as a workspace.
 * @param deps - host dependencies.
 * @param body - parsed request body.
 */
export async function handleCreateWorktree(deps: RouteDeps, body: unknown): Promise<RouteOutcome> {
  const parsed = readBody<CreateWorktreeBody>(body, ['repoPath', 'branch'])
  if (isOutcome(parsed)) return parsed
  const { repoPath, branch } = parsed
  if (!isAbsoluteDir(repoPath)) return fail(400, '"repoPath" must be an absolute directory')
  if (branch.trim() === '') return fail(400, '"branch" must be non-empty')
  const configured = deps.cachedSettings().rootDir.trim()
  if (configured !== '' && !isAbsoluteConfigPath(configured)) {
    return fail(400, `configured rootDir "${deps.cachedSettings().rootDir}" is not an absolute path`)
  }
  try {
    const facts = await probeRepo(deps.exec, repoPath, deps.dirExists)
    if (facts === undefined) return fail(400, `"${repoPath}" is not inside a git repository`)
    const rootDir = resolveRootDir(deps.cachedSettings(), deps.home())
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
