/**
 * PR/MR resolution, remote classification, and optional `ctx.forge` integration
 * for isolating pull/merge requests into dedicated Git worktrees.
 */

import { join } from 'node:path'
import { sanitizeBranchDir } from './normalize.js'
import type {
  PrCandidateItem,
  PrContextResult,
  PrErrorCode,
  PrProviderKind,
  PrRemoteInfo,
  PrResolveResult,
  WorktreeEntry,
} from './wire.js'

/** Project-internal layout directory relative to repoRoot. */
const PROJECT_LAYOUT_DIR = join('.dsh', 'gitworktree')

/** Timeout for optional `ctx.forge` readiness probes so the modal never stalls. */
const FORGE_READINESS_TIMEOUT_MS = 8_000

/** Separate timeout budget for optional `ctx.forge.listForViewer` queries after readiness passes. */
const FORGE_LIST_TIMEOUT_MS = 15_000

/** Minimal repository identity returned by `ctx.forge`. */
export interface ForgeRepositoryLike {
  readonly forge: string
  readonly host: string
  readonly owner: string
  readonly name: string
}

/** Minimal change request reference returned by `ctx.forge`. */
export interface ChangeRequestRefLike {
  readonly repository: ForgeRepositoryLike
  readonly number: number
}

/** Minimal change request snapshot shape from `ctx.forge.latest`. */
export interface ChangeRequestSnapshotLike {
  readonly url: string
  readonly title: string
  readonly state: 'open' | 'closed' | 'merged'
  readonly draft: boolean
  readonly author: string | null
  readonly headBranch: string
  readonly baseBranch: string
}

/** Minimal viewer list entry returned by `ctx.forge.listForViewer`. */
export interface ForgeViewerSummaryLike {
  readonly ref: ChangeRequestRefLike
  readonly url: string
  readonly title: string
  readonly draft: boolean
  readonly author: { readonly login: string } | null
  readonly checksRollup: 'none' | 'pending' | 'success' | 'failure'
  readonly reviewDecision: 'approved' | 'changes-requested' | 'review-required' | 'none'
  readonly updatedAt: string
}

export interface ForgeViewerListLike {
  readonly viewer: string
  readonly items: readonly ForgeViewerSummaryLike[]
  readonly total: number
}

export interface ForgeReadinessLike {
  readonly state: 'ready' | 'unauthenticated' | 'unavailable'
  readonly message: string | null
  readonly signIn?: { readonly command: string } | null
}

/** Minimal duck-typed contract matching `@deepseek-ai/dsh-experimental-forge` `ForgeService`. */
export interface ForgeServiceLike {
  repositoryFromRemote(url: string): ForgeRepositoryLike | undefined
  changeRequestFromUrl(url: string): ChangeRequestRefLike | undefined
  changeRequestUrl(ref: ChangeRequestRefLike): string
  readiness(repository: ForgeRepositoryLike, signal: AbortSignal): Promise<ForgeReadinessLike>
  viewerSources?(): readonly {
    readonly forge: string
    readonly hosts: readonly string[]
    readonly filters: ReadonlySet<string>
    readonly maxItems: number
  }[]
  listForViewer?(
    forge: string,
    query: {
      readonly host: string
      readonly filter: 'review-requested' | 'authored' | 'involved'
      readonly repository: { readonly owner: string; readonly name: string } | null
      readonly limit: number
    },
    signal: AbortSignal,
  ): Promise<ForgeViewerListLike | { readonly code: string; readonly message: string }>
  latest?(ref: ChangeRequestRefLike): { readonly snapshot?: ChangeRequestSnapshotLike } | undefined
  fetchChecks?(
    ref: ChangeRequestRefLike,
    signal: AbortSignal,
  ): Promise<ChangeRequestSnapshotLike | { readonly code: string; readonly message: string }>
}

/** Timeout for opportunistic `ctx.forge` single-PR metadata lookup during `/pr-resolve`. */
const FORGE_META_TIMEOUT_MS = 3_500

/**
 * Opportunistically fetch PR/MR metadata (title, author, state, draft, branches) from optional
 * `ctx.forge` when not already cached in `forge.latest`. Failures and timeouts degrade silently
 * to `undefined` so native Git checkout previews are never blocked.
 */
export async function fetchPrMeta(
  forge: ForgeServiceLike | undefined,
  remote: PrRemoteInfo | undefined,
  provider: PrProviderKind,
  number: number,
  signal?: AbortSignal,
): Promise<PrResolveResult['meta'] | undefined> {
  if (
    forge?.fetchChecks === undefined
    || remote === undefined
    || remote.host === null
    || remote.owner === null
    || remote.repo === null
    || signal?.aborted === true
  ) {
    return undefined
  }
  const controller = new AbortController()
  const onAbort = (): void => { controller.abort() }
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => { controller.abort() }, FORGE_META_TIMEOUT_MS)
  try {
    const result = await forge.fetchChecks(
      {
        repository: { forge: provider, host: remote.host, owner: remote.owner, name: remote.repo },
        number,
      },
      controller.signal,
    )
    if (result !== null && typeof result === 'object' && 'title' in result && typeof result.title === 'string') {
      return {
        title: result.title,
        author: result.author,
        state: result.state,
        draft: result.draft,
        headBranch: result.headBranch,
        baseBranch: result.baseBranch,
      }
    }
    return undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Runtime guard for optional `ctx.forge` service injection. */
export function isForgeServiceLike(value: unknown): value is ForgeServiceLike {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.repositoryFromRemote === 'function'
    && typeof record.changeRequestFromUrl === 'function'
    && typeof record.changeRequestUrl === 'function'
    && typeof record.readiness === 'function'
}

/** Parsed PR/MR user input (numeric ID or full web URL). */
export type ParsedPrInput =
  | { readonly kind: 'number'; readonly number: number; readonly hintProvider?: PrProviderKind }
  | {
      readonly kind: 'url'
      readonly provider: PrProviderKind
      readonly host: string
      readonly owner: string
      readonly repo: string
      readonly number: number
      readonly canonicalUrl: string
    }

function toProviderKind(forge: string): PrProviderKind | null {
  const lower = forge.toLowerCase()
  if (lower === 'github') return 'github'
  if (lower === 'gitlab') return 'gitlab'
  return null
}

function inferProviderFromHost(host: string): PrProviderKind | null {
  const lower = host.toLowerCase()
  if (lower === 'github.com' || lower.includes('github')) return 'github'
  if (lower === 'gitlab.com' || lower.includes('gitlab')) return 'gitlab'
  return null
}

function stripGitSuffix(path: string): string {
  return path.replace(/\/+$/, '').replace(/\.git$/i, '')
}

function splitOwnerAndRepo(fullPath: string): { owner: string; repo: string } | undefined {
  const cleaned = stripGitSuffix(fullPath).replace(/^\/+/, '')
  const parts = cleaned.split('/').filter(Boolean)
  if (parts.length < 2) return undefined
  const repo = parts.at(-1)
  if (repo === undefined || repo === '') return undefined
  const owner = parts.slice(0, -1).join('/')
  return { owner, repo }
}

/**
 * Parse a Git remote fetch URL (`https://`, `http://`, `ssh://`, `git://`, or `git@host:owner/repo.git`)
 * into normalized host, owner/namespace, repository name, and heuristic provider kind.
 */
export function parseRemoteUrl(url: string): {
  host: string
  owner: string
  repo: string
  provider: PrProviderKind | null
} | undefined {
  const trimmed = url.trim()
  if (trimmed === '') return undefined

  // SCP-like syntax: git@github.com:owner/repo.git or user@gitlab.example.com:group/sub/repo.git
  const scp = /^(?:[^@\s]+@)?([a-zA-Z0-9.-]+):([^/\s].*)$/.exec(trimmed)
  if (scp !== null && !trimmed.includes('://')) {
    const host = scp[1]?.toLowerCase()
    const path = scp[2]
    if (host === undefined || path === undefined) return undefined
    const split = splitOwnerAndRepo(path)
    if (split === undefined) return undefined
    return { host, owner: split.owner, repo: split.repo, provider: inferProviderFromHost(host) }
  }

  try {
    const parsed = new URL(trimmed)
    const protocol = parsed.protocol.toLowerCase()
    if (protocol !== 'https:' && protocol !== 'http:' && protocol !== 'ssh:' && protocol !== 'git:') {
      return undefined
    }
    const host = parsed.hostname.toLowerCase()
    if (host === '') return undefined
    const split = splitOwnerAndRepo(parsed.pathname)
    if (split === undefined) return undefined
    return { host, owner: split.owner, repo: split.repo, provider: inferProviderFromHost(host) }
  } catch {
    return undefined
  }
}

/**
 * Parse user input into a numeric PR/MR number (`42`, `#42`, `!42`) or a GitHub/GitLab web URL.
 * Supports self-hosted instances, nested GitLab namespaces, and trailing URL paths (`/files`, `/commits`, query, hash).
 */
export function parsePrInput(input: string): ParsedPrInput | undefined {
  const trimmed = input.trim()
  if (trimmed === '') return undefined

  const numeric = /^([#!])?(\d+)$/.exec(trimmed)
  if (numeric !== null) {
    const num = Number(numeric[2])
    if (!Number.isSafeInteger(num) || num <= 0) return undefined
    const prefix = numeric[1]
    return {
      kind: 'number',
      number: num,
      ...(prefix === '!' ? { hintProvider: 'gitlab' as const } : {}),
    }
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(trimmed)
  } catch {
    return undefined
  }
  const protocol = parsedUrl.protocol.toLowerCase()
  if (protocol !== 'https:' && protocol !== 'http:') return undefined
  const host = parsedUrl.hostname.toLowerCase()
  if (host === '') return undefined

  // GitLab: /<namespace...>/<repo>/-/merge_requests/<number> or legacy /<namespace...>/<repo>/merge_requests/<number>
  const glMatch = /^\/(.+?)(?:\/-)?\/merge_requests\/(\d+)(?:\/.*)?$/i.exec(parsedUrl.pathname)
  if (glMatch !== null) {
    const split = splitOwnerAndRepo(glMatch[1] ?? '')
    const num = Number(glMatch[2])
    if (split !== undefined && Number.isSafeInteger(num) && num > 0) {
      return {
        kind: 'url',
        provider: 'gitlab',
        host,
        owner: split.owner,
        repo: split.repo,
        number: num,
        canonicalUrl: `${parsedUrl.origin}/${split.owner}/${split.repo}/-/merge_requests/${num}`,
      }
    }
  }

  // GitHub: /<owner>/<repo>/pull/<number>
  const ghMatch = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/i.exec(parsedUrl.pathname)
  if (ghMatch !== null) {
    const owner = ghMatch[1]
    const repo = ghMatch[2]
    const num = Number(ghMatch[3])
    if (owner !== undefined && repo !== undefined && Number.isSafeInteger(num) && num > 0) {
      return {
        kind: 'url',
        provider: 'github',
        host,
        owner,
        repo,
        number: num,
        canonicalUrl: `${parsedUrl.origin}/${owner}/${repo}/pull/${num}`,
      }
    }
  }

  return undefined
}

/** Canonical local branch name with provider prefix to avoid multi-host collisions. */
export function formatPrBranchName(provider: PrProviderKind, number: number): string {
  return provider === 'gitlab' ? `gitlab-mr-${number}` : `github-pr-${number}`
}

/**
 * Concise PR/MR origin label stored in `<worktreeGitDir>/dsh-worktree-base` for
 * sidebar hover cards (e.g. `PR #42`, `PR #42 → main`, `MR !17 → develop`).
 */
export function formatPrBaseLabel(provider: PrProviderKind, number: number, baseBranch?: string): string {
  const prefix = provider === 'gitlab' ? `MR !${number}` : `PR #${number}`
  const trimmed = baseBranch?.trim()
  return trimmed !== undefined && trimmed !== '' ? `${prefix} → ${trimmed}` : prefix
}

/** Git refspec fetched into a temporary ref (`refs/dsh-pr-tmp/<uuid>`) for a given provider and PR/MR number. */
export function prRefSpec(provider: PrProviderKind, number: number): string {
  return provider === 'gitlab'
    ? `refs/merge-requests/${number}/head`
    : `refs/pull/${number}/head`
}

/** Build the canonical web URL for a PR/MR on a known remote, using `forge` when available. */
export function buildCanonicalPrUrl(
  remote: PrRemoteInfo,
  provider: PrProviderKind,
  number: number,
  forge?: ForgeServiceLike,
): string | null {
  if (remote.host === null || remote.owner === null || remote.repo === null) return null
  if (forge !== undefined) {
    try {
      return forge.changeRequestUrl({
        repository: { forge: provider, host: remote.host, owner: remote.owner, name: remote.repo },
        number,
      })
    } catch {
      // Provider for this forge family may not be registered; fall back to standard URL construction.
    }
  }
  return provider === 'gitlab'
    ? `https://${remote.host}/${remote.owner}/${remote.repo}/-/merge_requests/${number}`
    : `https://${remote.host}/${remote.owner}/${remote.repo}/pull/${number}`
}

/** Classify repository remotes using optional `ctx.forge` first, falling back to built-in URL parsing. */
export function classifyRemotes(
  remotes: readonly { name: string; url: string }[],
  forge?: ForgeServiceLike,
): PrRemoteInfo[] {
  return remotes.map(({ name, url }) => {
    const fromForge = forge?.repositoryFromRemote(url)
    if (fromForge !== undefined) {
      return {
        name,
        url,
        provider: toProviderKind(fromForge.forge),
        host: fromForge.host.toLowerCase(),
        owner: fromForge.owner,
        repo: fromForge.name,
      }
    }
    const parsed = parseRemoteUrl(url)
    if (parsed !== undefined) {
      return {
        name,
        url,
        provider: parsed.provider,
        host: parsed.host,
        owner: parsed.owner,
        repo: parsed.repo,
      }
    }
    return { name, url, provider: null, host: null, owner: null, repo: null }
  })
}

/** Choose default remote: recognized `upstream` > `origin` > first recognized remote > first remote. */
export function pickDefaultRemote(remotes: readonly PrRemoteInfo[]): string | null {
  const upstream = remotes.find(r => r.name === 'upstream' && r.provider !== null)
    ?? remotes.find(r => r.name === 'upstream')
  if (upstream !== undefined) return upstream.name
  const origin = remotes.find(r => r.name === 'origin' && r.provider !== null)
    ?? remotes.find(r => r.name === 'origin')
  if (origin !== undefined) return origin.name
  return remotes.find(r => r.provider !== null)?.name ?? remotes[0]?.name ?? null
}

function sameRepo(remote: PrRemoteInfo, host: string, owner: string, repo: string): boolean {
  if (remote.host === null || remote.owner === null || remote.repo === null) return false
  return remote.host.toLowerCase() === host.toLowerCase()
    && remote.owner.toLowerCase() === owner.toLowerCase()
    && remote.repo.toLowerCase() === repo.toLowerCase()
}

function worktreePathForBranch(worktrees: readonly WorktreeEntry[], branch: string): string | undefined {
  return worktrees.find(w => !w.main && w.branch === branch)?.path
}

/** Error thrown when PR input is invalid or does not belong to the repository. */
export class PrResolutionError extends Error {
  readonly code: PrErrorCode
  readonly params: Record<string, string | number> | undefined

  constructor(message: string, code: PrErrorCode, params?: Record<string, string | number>) {
    super(message)
    this.name = 'PrResolutionError'
    this.code = code
    this.params = params
  }
}

export interface ResolvePrTargetInput {
  repoRoot: string
  input: string
  remotes: readonly PrRemoteInfo[]
  worktrees: readonly WorktreeEntry[]
  localBranches: readonly string[]
  requestedRemote?: string
  requestedProvider?: PrProviderKind
  forge?: ForgeServiceLike
}

/**
 * Resolve a PR/MR ID or URL against the repository's remotes, verifying repository ownership
 * and reporting any existing isolated worktree or local branch collision.
 */
export function resolvePrTarget(args: ResolvePrTargetInput): PrResolveResult {
  const { repoRoot, input, remotes, worktrees, localBranches, requestedRemote, requestedProvider, forge } = args
  if (remotes.length === 0) {
    throw new PrResolutionError('This repository has no configured Git remotes.', 'no_remotes')
  }
  const trimmed = input.trim()
  if (trimmed === '') {
    throw new PrResolutionError('Enter a PR/MR number or URL.', 'empty_input')
  }

  let provider: PrProviderKind
  let number: number
  let matchedRemote: PrRemoteInfo | undefined
  let canonicalUrl: string | null = null
  let forgeRef: ChangeRequestRefLike | undefined

  const fromForgeUrl = forge?.changeRequestFromUrl(trimmed)
  if (fromForgeUrl !== undefined) {
    const kind = toProviderKind(fromForgeUrl.repository.forge)
    if (kind === null) {
      throw new PrResolutionError(
        `Unsupported forge provider "${fromForgeUrl.repository.forge}".`,
        'unsupported_provider',
        { provider: fromForgeUrl.repository.forge },
      )
    }
    provider = kind
    number = fromForgeUrl.number
    forgeRef = fromForgeUrl
    try {
      canonicalUrl = forge!.changeRequestUrl(fromForgeUrl)
    } catch {
      canonicalUrl = provider === 'gitlab'
        ? `https://${fromForgeUrl.repository.host}/${fromForgeUrl.repository.owner}/${fromForgeUrl.repository.name}/-/merge_requests/${number}`
        : `https://${fromForgeUrl.repository.host}/${fromForgeUrl.repository.owner}/${fromForgeUrl.repository.name}/pull/${number}`
    }
    const matchingRemotes = remotes.filter(r =>
      sameRepo(r, fromForgeUrl.repository.host, fromForgeUrl.repository.owner, fromForgeUrl.repository.name),
    )
    if (matchingRemotes.length === 0) {
      throw new PrResolutionError(
        `URL points to ${fromForgeUrl.repository.owner}/${fromForgeUrl.repository.name} (${fromForgeUrl.repository.host}), which does not match any remote in this repository.`,
        'url_repo_mismatch',
        { owner: fromForgeUrl.repository.owner, repo: fromForgeUrl.repository.name, host: fromForgeUrl.repository.host },
      )
    }
    matchedRemote = (requestedRemote !== undefined
      ? matchingRemotes.find(r => r.name === requestedRemote)
      : undefined) ?? matchingRemotes[0]
  } else {
    const parsed = parsePrInput(trimmed)
    if (parsed === undefined) {
      throw new PrResolutionError(
        'Enter a valid PR/MR number (e.g. 42) or a GitHub/GitLab PR/MR URL.',
        'invalid_input',
      )
    }
    if (parsed.kind === 'url') {
      provider = parsed.provider
      number = parsed.number
      canonicalUrl = parsed.canonicalUrl
      const matchingRemotes = remotes.filter(r => sameRepo(r, parsed.host, parsed.owner, parsed.repo))
      if (matchingRemotes.length === 0) {
        throw new PrResolutionError(
          `URL points to ${parsed.owner}/${parsed.repo} (${parsed.host}), which does not match any remote in this repository.`,
          'url_repo_mismatch',
          { owner: parsed.owner, repo: parsed.repo, host: parsed.host },
        )
      }
      matchedRemote = (requestedRemote !== undefined
        ? matchingRemotes.find(r => r.name === requestedRemote)
        : undefined) ?? matchingRemotes[0]
    } else {
      number = parsed.number
      const chosenName = requestedRemote ?? pickDefaultRemote(remotes)
      matchedRemote = remotes.find(r => r.name === chosenName)
      if (matchedRemote === undefined) {
        throw new PrResolutionError(
          `Remote "${String(chosenName)}" was not found in this repository.`,
          'remote_not_found',
          { remote: String(chosenName) },
        )
      }
      const inferred = requestedProvider ?? matchedRemote.provider ?? parsed.hintProvider
      if (inferred === undefined || inferred === null) {
        throw new PrResolutionError(
          `Could not detect whether remote "${matchedRemote.name}" hosts GitHub PRs or GitLab MRs. Select a platform or paste the full PR/MR URL.`,
          'provider_undetected',
          { remote: matchedRemote.name },
        )
      }
      provider = inferred
      canonicalUrl = buildCanonicalPrUrl(matchedRemote, provider, number, forge)
      if (matchedRemote.host !== null && matchedRemote.owner !== null && matchedRemote.repo !== null) {
        forgeRef = {
          repository: {
            forge: provider,
            host: matchedRemote.host,
            owner: matchedRemote.owner,
            name: matchedRemote.repo,
          },
          number,
        }
      }
    }
  }

  const remoteName = matchedRemote!.name
  const localBranch = formatPrBranchName(provider, number)
  const targetPath = join(repoRoot, PROJECT_LAYOUT_DIR, sanitizeBranchDir(localBranch))
  const existingWorktreePath = worktreePathForBranch(worktrees, localBranch)
  const existingBranch = localBranches.includes(localBranch)
  const occupiedByMain = worktrees.some(w => w.main && w.branch === localBranch)

  let meta: PrResolveResult['meta']
  if (forge !== undefined && forgeRef !== undefined) {
    const snap = forge.latest?.(forgeRef)?.snapshot
    if (snap !== undefined) {
      meta = {
        title: snap.title,
        author: snap.author,
        state: snap.state,
        draft: snap.draft,
        headBranch: snap.headBranch,
        baseBranch: snap.baseBranch,
      }
    }
  }

  return {
    provider,
    number,
    remote: remoteName,
    refSpec: prRefSpec(provider, number),
    localBranch,
    targetPath,
    canonicalUrl,
    ...(existingWorktreePath === undefined ? {} : { existingWorktreePath }),
    ...(existingBranch ? { existingBranch: true } : {}),
    ...(occupiedByMain ? { occupiedByMain: true } : {}),
    ...(meta === undefined ? {} : { meta }),
  }
}

const FILTER_ORDER = ['review-requested', 'authored', 'involved'] as const

function createTimeoutSignal(timeoutMs: number, externalSignal?: AbortSignal): {
  readonly signal: AbortSignal
  readonly cleanup: () => void
} {
  const controller = new AbortController()
  if (externalSignal?.aborted === true) {
    controller.abort(externalSignal.reason)
    return { signal: controller.signal, cleanup: () => {} }
  }
  const onAbort = (): void => { controller.abort(externalSignal?.reason) }
  externalSignal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => { controller.abort(new Error('Forge query timed out')) }, timeoutMs)
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', onAbort)
    },
  }
}

/**
 * Assemble `/pr-context` payload: classified remotes + optional `ctx.forge` readiness &
 * open PR/MR candidate lists scoped to the repository (or an explicitly selected remote).
 * Failures or unauthenticated states degrade cleanly to `candidates: []` without blocking native Git checkout.
 */
export async function loadPrContext(args: {
  repoRoot: string
  repoName: string
  rawRemotes: readonly { name: string; url: string }[]
  worktrees: readonly WorktreeEntry[]
  requestedRemote?: string
  forge?: ForgeServiceLike
  signal?: AbortSignal
}): Promise<PrContextResult> {
  const { repoRoot, repoName, rawRemotes, worktrees, requestedRemote, forge, signal: externalSignal } = args
  const remotes = classifyRemotes(rawRemotes, forge)
  const defaultRemote = pickDefaultRemote(remotes)

  if (forge === undefined) {
    return {
      repoRoot,
      repoName,
      remotes,
      defaultRemote,
      forge: { available: false, readiness: 'unsupported' },
      candidates: [],
    }
  }

  const explicitRemote = requestedRemote !== undefined
    ? remotes.find(r => r.name === requestedRemote)
    : undefined
  const primaryRemote = explicitRemote !== undefined
    ? explicitRemote
    : (remotes.find(r => r.name === defaultRemote && r.provider !== null)
      ?? remotes.find(r => r.provider !== null && r.host !== null && r.owner !== null && r.repo !== null))

  if (primaryRemote === undefined || primaryRemote.provider === null || primaryRemote.host === null || primaryRemote.owner === null || primaryRemote.repo === null) {
    return {
      repoRoot,
      repoName,
      remotes,
      defaultRemote,
      forge: { available: true, readiness: 'unsupported' },
      candidates: [],
    }
  }

  const repository: ForgeRepositoryLike = {
    forge: primaryRemote.provider,
    host: primaryRemote.host,
    owner: primaryRemote.owner,
    name: primaryRemote.repo,
  }
  const readinessBudget = createTimeoutSignal(FORGE_READINESS_TIMEOUT_MS, externalSignal)

  let readiness: ForgeReadinessLike
  try {
    readiness = await forge.readiness(repository, readinessBudget.signal)
  } catch (error) {
    return {
      repoRoot,
      repoName,
      remotes,
      defaultRemote,
      forge: {
        available: true,
        readiness: 'unavailable',
        message: error instanceof Error ? error.message : String(error),
      },
      candidates: [],
    }
  } finally {
    readinessBudget.cleanup()
  }

  if (readiness.state !== 'ready') {
    return {
      repoRoot,
      repoName,
      remotes,
      defaultRemote,
      forge: {
        available: true,
        readiness: readiness.state,
        ...(readiness.signIn?.command === undefined ? {} : { signInCommand: readiness.signIn.command }),
        ...(readiness.message === null ? {} : { message: readiness.message }),
      },
      candidates: [],
    }
  }

  if (typeof forge.listForViewer !== 'function') {
    return {
      repoRoot,
      repoName,
      remotes,
      defaultRemote,
      forge: {
        available: true,
        readiness: 'unavailable',
        listUnsupported: true,
      },
      candidates: [],
    }
  }

  let activeFilters: readonly ('review-requested' | 'authored' | 'involved')[] = FILTER_ORDER
  let limit = 20
  if (typeof forge.viewerSources === 'function') {
    const hostLower = primaryRemote.host.toLowerCase()
    const viewerSource = forge.viewerSources().find(
      s => s.forge.toLowerCase() === primaryRemote.provider
        && s.hosts.some(h => h.toLowerCase() === hostLower),
    )
    if (viewerSource === undefined) {
      return {
        repoRoot,
        repoName,
        remotes,
        defaultRemote,
        forge: {
          available: true,
          readiness: 'unavailable',
          listUnsupported: true,
        },
        candidates: [],
      }
    }
    activeFilters = FILTER_ORDER.filter(filter => viewerSource.filters.has(filter))
    if (activeFilters.length === 0) {
      return {
        repoRoot,
        repoName,
        remotes,
        defaultRemote,
        forge: {
          available: true,
          readiness: 'unavailable',
          listUnsupported: true,
        },
        candidates: [],
      }
    }
    limit = Math.max(1, Math.min(20, viewerSource.maxItems))
  }
  const listBudget = createTimeoutSignal(FORGE_LIST_TIMEOUT_MS, externalSignal)

  const seen = new Set<string>()
  const candidates: PrCandidateItem[] = []
  let lists: PromiseSettledResult<{
    filter: 'review-requested' | 'authored' | 'involved'
    res: ForgeViewerListLike | { readonly code: string; readonly message: string }
  }>[]
  try {
    lists = await Promise.allSettled(
      activeFilters.map(async (filter) => ({
        filter,
        res: await forge.listForViewer!(
          primaryRemote.provider!,
          {
            host: primaryRemote.host!,
            filter,
            repository: { owner: primaryRemote.owner!, name: primaryRemote.repo! },
            limit,
          },
          listBudget.signal,
        ),
      })),
    )
  } finally {
    listBudget.cleanup()
  }

  let succeededLists = 0
  let firstFailure: { readonly code: string; readonly message: string } | undefined

  for (const settled of lists) {
    if (settled.status !== 'fulfilled') {
      firstFailure ??= {
        code: 'unavailable',
        message: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
      }
      continue
    }
    const { filter, res } = settled.value
    if (!('items' in res)) {
      firstFailure ??= { code: res.code, message: res.message }
      continue
    }
    succeededLists += 1
    for (const item of res.items) {
      const provider = toProviderKind(item.ref.repository.forge) ?? primaryRemote.provider
      const key = `${provider}:${item.ref.repository.host.toLowerCase()}:${item.ref.repository.owner.toLowerCase()}/${item.ref.repository.name.toLowerCase()}#${item.ref.number}`
      if (seen.has(key)) continue
      seen.add(key)
      const localBranch = formatPrBranchName(provider, item.ref.number)
      const existingWt = worktreePathForBranch(worktrees, localBranch)
      candidates.push({
        provider,
        host: item.ref.repository.host,
        owner: item.ref.repository.owner,
        repo: item.ref.repository.name,
        number: item.ref.number,
        url: item.url,
        title: item.title,
        author: item.author?.login ?? null,
        draft: item.draft,
        checksRollup: item.checksRollup,
        reviewDecision: item.reviewDecision,
        filter,
        updatedAt: item.updatedAt,
        remote: primaryRemote.name,
        localBranch,
        ...(existingWt === undefined ? {} : { existingWorktreePath: existingWt }),
      })
    }
  }

  if (succeededLists === 0 && firstFailure !== undefined) {
    if (firstFailure.code === 'unsupported') {
      return {
        repoRoot,
        repoName,
        remotes,
        defaultRemote,
        forge: {
          available: true,
          readiness: 'unavailable',
          listUnsupported: true,
        },
        candidates: [],
      }
    }
    return {
      repoRoot,
      repoName,
      remotes,
      defaultRemote,
      forge: {
        available: true,
        readiness: firstFailure.code === 'unauthenticated' ? 'unauthenticated' : 'unavailable',
        message: firstFailure.message,
      },
      candidates: [],
    }
  }

  candidates.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  return {
    repoRoot,
    repoName,
    remotes,
    defaultRemote,
    forge: { available: true, readiness: 'ready' },
    candidates,
  }
}
