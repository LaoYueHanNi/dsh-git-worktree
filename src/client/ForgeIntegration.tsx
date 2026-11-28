/**
 * Optional slot contributions for `@deepseek-ai/dsh-experimental-client-ui-forge`:
 * - `ForgeCardCheckoutButton` mounts on `forge.change-request.card.actions`
 * - `ForgeDiffToolbarCheckoutButton` mounts on `forge.changes.toolbar`
 *
 * When `client-ui-forge` is not enabled on the host, `ctx.slots.inject` simply waits
 * without rendering anything or adding runtime dependencies.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { Button, MenuItemButton, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { openCheckoutPr } from './action-bus.ts'
import { PrCheckoutGlyph } from './CheckoutPrModal.tsx'
import type { WorkspaceGitCache } from './workspace-git-cache.ts'

export interface ForgeSlotDeps {
  readonly gitCache: WorkspaceGitCache
  readonly resolveSessionPath: (sessionId: string) => string | undefined
}

export interface ForgeCardActionsSlotProps extends ForgeSlotDeps, PropsLocale<'git-worktree'> {
  readonly sessionId: string
  readonly url: string
}

export interface ForgeChangesToolbarSlotProps extends ForgeSlotDeps, PropsLocale<'git-worktree'> {
  readonly target: {
    readonly sessionId: string
    readonly source: { readonly kind: 'local' } | { readonly kind: 'change'; readonly url: string }
  }
  readonly form: 'bar' | 'menu'
  readonly close: () => void
}

export function prBranchFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim())
    const gl = /^\/.+?(?:\/-)?\/merge_requests\/(\d+)(?:\/.*)?$/i.exec(parsed.pathname)
    if (gl !== null && gl[1] !== undefined) return `gitlab-mr-${gl[1]}`
    const gh = /^\/[^/]+\/[^/]+\/pull\/(\d+)(?:\/.*)?$/i.exec(parsed.pathname)
    if (gh !== null && gh[1] !== undefined) return `github-pr-${gh[1]}`
    return null
  } catch {
    return null
  }
}

function useRepoTarget(
  sessionId: string | undefined,
  gitCache: WorkspaceGitCache,
  resolveSessionPath: (id: string) => string | undefined,
): { readonly repoRoot: string; readonly repoName: string; readonly branch: string | null; readonly main: boolean } | null {
  useSyncExternalStore(
    listener => gitCache.subscribe(listener),
    () => gitCache.getSnapshot(),
    () => gitCache.getSnapshot(),
  )
  const cwd = sessionId === undefined ? undefined : resolveSessionPath(sessionId)
  const facts = cwd === undefined ? undefined : gitCache.get(cwd)

  useEffect(() => {
    if (cwd !== undefined && facts === undefined) {
      void gitCache.syncPaths([cwd])
    }
  }, [cwd, facts, gitCache])

  if (facts === undefined || facts === null) return null
  return { repoRoot: facts.repoRoot, repoName: facts.repoName, branch: facts.branch, main: facts.main }
}

function isInTargetPrWorktree(
  repo: { readonly branch: string | null; readonly main: boolean },
  url: string,
): boolean {
  if (repo.main || repo.branch === null) return false
  const expected = prBranchFromUrl(url)
  return expected !== null && repo.branch === expected
}

/** Icon button added to the Forge change-request card header (`forge.change-request.card.actions`). */
export function ForgeCardCheckoutButton({
  sessionId,
  url,
  gitCache,
  resolveSessionPath,
  t,
}: ForgeCardActionsSlotProps) {
  const repo = useRepoTarget(sessionId, gitCache, resolveSessionPath)
  if (repo === null) return null
  const inPrWorktree = isInTargetPrWorktree(repo, url)
  const label = inPrWorktree ? t('forgeSlot.syncTooltip') : t('forgeSlot.checkoutTooltip')
  return (
    <Tooltip label={label} side="top" delayMs={500}>
      <Button
        size="sm"
        variant="ghost"
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation()
          openCheckoutPr(repo.repoRoot, repo.repoName, {
            initialInput: url,
            ...(inPrWorktree ? { initialIfExists: 'update' as const } : {}),
          })
        }}
      >
        <PrCheckoutGlyph size={14} />
      </Button>
    </Tooltip>
  )
}

/** Toolbar/menu entry added to the Forge right-sidebar PR diff view (`forge.changes.toolbar`). */
export function ForgeDiffToolbarCheckoutButton({
  target,
  form,
  close,
  gitCache,
  resolveSessionPath,
  t,
}: ForgeChangesToolbarSlotProps) {
  const sessionId = target.source.kind === 'change' ? target.sessionId : undefined
  const repo = useRepoTarget(sessionId, gitCache, resolveSessionPath)
  if (target.source.kind !== 'change' || repo === null) return null
  const prUrl = target.source.url
  const inPrWorktree = isInTargetPrWorktree(repo, prUrl)
  const tooltip = inPrWorktree ? t('forgeSlot.syncTooltip') : t('forgeSlot.checkoutTooltip')
  const label = inPrWorktree ? t('forgeSlot.syncLabel') : t('forgeSlot.checkoutLabel')

  const launch = (): void => {
    close()
    openCheckoutPr(repo.repoRoot, repo.repoName, {
      initialInput: prUrl,
      ...(inPrWorktree ? { initialIfExists: 'update' as const } : {}),
    })
  }

  if (form === 'menu') {
    return (
      <MenuItemButton icon={<PrCheckoutGlyph size={14} />} onSelect={launch}>
        {label}
      </MenuItemButton>
    )
  }

  return (
    <Tooltip label={tooltip} side="bottom" delayMs={500}>
      <Button size="sm" variant="ghost" aria-label={tooltip} onClick={launch}>
        <PrCheckoutGlyph size={14} />
      </Button>
    </Tooltip>
  )
}
