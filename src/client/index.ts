/**
 * dsh-git-worktree browser half: the composer branch chip + worktree toggle
 * (conversation.input.left) for blank sessions and the plugin configuration
 * card on the Plugins tab (the `git-worktree` settings namespace — the
 * worktree storage root — edited through the settings scope). Repo facts and
 * worktree creation flow through the host half's own routes; adopting a
 * freshly created worktree registers it and starts a session through the
 * framework's uiWorkspace navigation.
 */

import { useEffect } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the branded Session id host 0.1.2 publishes on the session types
// subpath (the dead dsh-client-runtime used to carry it).
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: the branded Workspace id from the Workspace controller package.
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls ctx.sessions (ISessions) — must load the client face, not
// the Host `@deepseek-ai/dsh-session` SessionStore.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the Remote client merge (ctx.remote.$host Host facts) and the
// connection merge, both behind the gateway/connection client faces.
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the ui-conversation SlotMap merge (input region entries).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-settings SlotMap merge ('settings.section') and the
// configForms service declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the ui-plugin-manager keyed-slot declarations
// ('plugins.bundle.config' and siblings) into this program. The value face
// stays uncompromised: cross-plugin collaboration goes through the slot system.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Type-only: pulls the ui-workspace service merge (ctx.uiWorkspace) into this
// program — host 0.1.2 keeps session start and directory picking there while
// `workspaces` is the pure Workspace-row controller.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the ui-renderer merge (ctx.slots, the SlotRegistry) into
// this program — the slots service Context declaration lives on ui-renderer.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: session-domain slot kit (conversation.input.left owner share).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { IconBranchOutlineRegular, IconFolderCloseRegular, IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { BranchChipDock } from './BranchChip.tsx'
import { CardForm, type SectionValue } from './card-form.ts'
import { CONTEXT_MENU_ICON_KEYS, registerNativeContextMenus, type ContextMenusLike } from './context-menus.ts'
import { DeferredWorktreeDock, notifyDeferredWorktreeState } from './DeferredWorktreeDock.tsx'
import { GitWorktreeCard } from './GitWorktreeCard.tsx'
import { LegacySessionMenuItem } from './LegacySessionMenuItem.tsx'
import { SidebarWorktreeHover, SidebarWorktreeTrailing } from './SidebarWorktreeBadge.tsx'
import { WorktreeActionHost } from './WorktreeActionHost.tsx'
import type { WorktreeManagerFace } from './WorktreeManagerModal.tsx'
import type { DeferredWorktreeCompleted, DeferredWorktreeSpec } from '../wire.ts'
import { fetchDeferredWorktree, requestArmDeferredWorktree, requestDeferredWorktreeAction, requestGroupWorktrees, requestInspectWorktree, requestPathExists, requestPurgeDirectory, requestRemoveWorktree, requestSetSessionDirectory, requestWorktreesAll } from './api.ts'
import { en, zh, type GitWorktreeKey } from './locales.ts'
import { WorktreeToastHost } from './ToastHost.tsx'
import { emitToast } from './toast-bus.ts'
import { collectWorktreeOwnership, findReusableBlankSessionInWorktree, hasForgeManagedWorktree, resolveEffectiveSessionPath, selectSessionDirectory, type SessionListSnapshotLike, type SessionsDirectorySourceLike } from './session-directory.ts'
import { createWorkspaceGitCache, type SnapshotObservable } from './workspace-git-cache.ts'
import { pathKey, planPrune, runAutoPrune } from './worktree-prune.ts'
import { removeWorktreeFully } from './worktree-remove-flow.ts'
import { recordPruneRun } from './prune-history.ts'
import type { AdoptWorktreeOptions, BranchChipInjected } from './slots.ts'

export type { AdoptWorktreeOptions, BranchChipInjected } from './slots.ts'
export type { GitWorktreeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The git-worktree chip, dialogs, and settings card copy. */
    'git-worktree': GitWorktreeKey
  }
  interface SlotMap {
    /** Application-level overlay slot owned by ui-layout (DSH >= 0.2.0-rc.1). */
    'shell.overlay': { kind: 'list'; scope: 'root' }
    /** New-session top-right hero options owned by ui-conversation (`forge-panel.worktree` sits here at priority 0). */
    'conversation.hero.options': { kind: 'list'; scope: 'session' }
    /** Context-menu icon renderer keyed by action icon key (DSH >= 0.2.2-rc.5). */
    'contextMenu.icon': { kind: 'keyed'; scope: 'root'; inline: true; owner: { icon: { readonly key: string; readonly src?: string } } }
    /** Non-interactive icons after the session row's time label (DSH >= 0.2.2-rc.5). */
    'sidebar.session.row.trailing': { kind: 'list'; scope: 'root'; inline: true; owner: { readonly sessionId: SessionId } }
  }
}

type ForgePanelCancelWorktreeFn = (sessionId: SessionId) => Promise<unknown>

const resolveForgePanelCancelWorktree = (remote: unknown): ForgePanelCancelWorktreeFn | undefined => {
  if (typeof remote !== 'object' || remote === null) return undefined
  const forgePanel = (remote as { forgePanel?: unknown }).forgePanel
  if (typeof forgePanel !== 'object' || forgePanel === null) return undefined
  const cancel = (forgePanel as { cancelWorktree?: unknown }).cancelWorktree
  return typeof cancel === 'function' ? (cancel as ForgePanelCancelWorktreeFn).bind(forgePanel) : undefined
}

/**
 * Null renderer used to shadow official `forge-panel.worktree` at higher
 * precedence (priority -10). While mounted on a blank session, it also cancels
 * any leftover official `forgeWorktree` request that may have been persisted on
 * that reused blank session before this plugin hid the toggle, preventing
 * silent nested `.agents/worktrees/...` creation on the first user turn.
 */
function HiddenOfficialWorktreeEntry(props?: {
  readonly sessionId?: SessionId
  readonly cancelOfficialWorktree?: (sessionId: SessionId) => void
}): null {
  const sessionId = props?.sessionId
  const cancel = props?.cancelOfficialWorktree
  useEffect(() => {
    if (sessionId !== undefined && cancel !== undefined) cancel(sessionId)
  }, [sessionId, cancel])
  return null
}

/** Official forge-panel worktree toggle slot entry id. */
const OFFICIAL_WORKTREE_SLOT_ID = 'forge-panel.worktree'

/** Dictionary namespace owned by this plugin. */
const NS = 'git-worktree'

/**
 * Namespace of the git-worktree settings section. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
const GIT_WORKTREE_NS = 'git-worktree'

/**
 * This package's own name — the key `plugins.bundle.config` dispatches by
 * (the slot contract keys a bundle's own configuration by the bundle's
 * package name; it matches the `cordis.patch.yml` entry verbatim).
 */
const PLUGIN_PACKAGE = '@laoyuehanni/dsh-git-worktree'

/** Minimal SyncedConfig reference face (DSH 0.2.2+ @deepseek-ai/dsh-client-config). */
export interface SyncedConfigRefLike<T = unknown> {
  get(): T
  subscribe(listener: () => void): () => void
}

/**
 * Minimal SyncedConfig map passed as the second argument of `apply(ctx, config)`
 * on hosts that project Host `.volatile()` fields to the browser. Absent
 * (`undefined`) on older hosts, where `configForms` remains the fallback read source.
 */
export interface SyncedConfigLike {
  readonly openGraphByDefault?: SyncedConfigRefLike<boolean | undefined>
  readonly autoPruneWorktrees?: SyncedConfigRefLike<boolean | undefined>
  readonly keepWorktrees?: SyncedConfigRefLike<number | undefined>
  readonly hideOfficialWorktreeEntry?: SyncedConfigRefLike<boolean | undefined>
  readonly switchSessionDirectory?: SyncedConfigRefLike<boolean | undefined>
  readonly manageOfficialWorktrees?: SyncedConfigRefLike<boolean | undefined>
}

const hasSyncedRef = <T>(ref: SyncedConfigRefLike<T> | undefined): ref is SyncedConfigRefLike<T> =>
  ref !== undefined && typeof ref.get === 'function' && typeof ref.subscribe === 'function'

const isObservable = (value: unknown): value is SnapshotObservable<unknown> =>
  typeof value === 'object'
  && value !== null
  && typeof (value as { getSnapshot?: unknown }).getSnapshot === 'function'
  && typeof (value as { subscribe?: unknown }).subscribe === 'function'

const hasContextMenus = (value: unknown): value is { readonly contextMenus: ContextMenusLike } =>
  typeof value === 'object'
  && value !== null
  && typeof (value as { contextMenus?: { register?: unknown } }).contextMenus?.register === 'function'

/** Required services: the slot ledger, session/workspace runtimes, the
 * workspace navigation/directory face, copy, and the config forms backing
 * the plugin configuration card. */
export const inject = ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'locale', 'connection', 'remote', 'configForms']

export function apply(ctx: ClientContext, config?: SyncedConfigLike): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'git-worktree: dictionaries')

  const groupingForm = ctx.configForms.get<SectionValue>(GIT_WORKTREE_NS)
  const openGraphRef = hasSyncedRef(config?.openGraphByDefault) ? config.openGraphByDefault : undefined
  const autoPruneRef = hasSyncedRef(config?.autoPruneWorktrees) ? config.autoPruneWorktrees : undefined
  const keepWorktreesRef = hasSyncedRef(config?.keepWorktrees) ? config.keepWorktrees : undefined
  const hideOfficialRef = hasSyncedRef(config?.hideOfficialWorktreeEntry) ? config.hideOfficialWorktreeEntry : undefined
  const switchSessionDirRef = hasSyncedRef(config?.switchSessionDirectory) ? config.switchSessionDirectory : undefined

  const readHideOfficialEntry = (): boolean => {
    if (hideOfficialRef !== undefined) return hideOfficialRef.get() ?? true
    const section = groupingForm.getSnapshot()
    return section.status === 'ready' ? (section.value?.hideOfficialWorktreeEntry ?? true) : true
  }

  const readSwitchSessionDirectory = (): boolean => {
    if (switchSessionDirRef !== undefined) return switchSessionDirRef.get() === true
    const section = groupingForm.getSnapshot()
    return section.status === 'ready' && section.value?.switchSessionDirectory === true
  }

  const gitCache = createWorkspaceGitCache()
  const armedDeferredSessions = new Set<string>()

  // Optional bridge to official `remote.forgePanel.cancelWorktree` (strict
  // Cordis `ctx.inject` so hosts without `forge-bundle` stay unaffected).
  let forgePanelCancelWorktree: ForgePanelCancelWorktreeFn | undefined
  if (typeof ctx.inject === 'function') {
    const injectOptional = ctx.inject.bind(ctx) as (
      deps: readonly string[],
      callback: (scope: ClientContext) => void,
    ) => unknown
    injectOptional(['remote.forgePanel'], (forgeCtx) => {
      const cancel = resolveForgePanelCancelWorktree(forgeCtx.remote)
      if (cancel === undefined) return
      forgePanelCancelWorktree = cancel
      forgeCtx.effect(() => () => {
        if (forgePanelCancelWorktree === cancel) forgePanelCancelWorktree = undefined
      }, 'git-worktree: optional forgePanel.cancelWorktree bridge')
    })
  }
  const cancelOfficialWorktree = (sessionId: SessionId): void => {
    const cancel = forgePanelCancelWorktree
    if (cancel === undefined) return
    void cancel(sessionId).catch(() => {
      // Idempotent best-effort cleanup: already started or no open request is harmless.
    })
  }

  /**
   * Dual-mode worktree ownership facts read from live snapshots:
   * - `workspaceId` is present ONLY for a standalone workspace on `path`
   *   (never a parent repository workspace in shared-directory mode);
   * - `running`, `archiveIds`, and `activity` include every session whose
   *   effective `workingDirectory` sits inside `path`.
   */
  const ownershipFacts = (path: string) => {
    const workspaces = ctx.workspaces.list.getSnapshot()
    const sessions = ctx.sessions.list.getSnapshot() as SessionListSnapshotLike
    return collectWorktreeOwnership(
      path,
      workspaces.items.map(item => ({
        workspaceId: item.workspaceId as string,
        path: item.path,
        sessionIds: item.sessionIds as readonly string[],
      })),
      sessions,
      workspaces.archivedSessionIds as readonly string[],
    )
  }

  const resolveRepoRootForWorktree = async (targetPath: string, hint?: string): Promise<string | undefined> => {
    if (hint !== undefined && hint.length > 0) return hint
    const cached = gitCache.get(targetPath)
    if (cached !== undefined && cached !== null) return cached.repoRoot
    const probed = await requestGroupWorktrees([targetPath])
    if (probed.ok) {
      const facts = probed.facts[targetPath]
      if (facts !== undefined && facts !== null) return facts.repoRoot
    }
    return undefined
  }

  const adoptWorktree = async (path: string, options?: AdoptWorktreeOptions): Promise<void> => {
    const workspacesSnapshot = ctx.workspaces.list.getSnapshot()
    const targetKey = pathKey(path)

    // Rule A: if a standalone Workspace already owns this directory (including
    // the main repository checkout itself), always open it directly instead of
    // splitting sessions for the same worktree across two sidebar locations or
    // redundantly calling `session-cwd` when hopping back to the main repo.
    const existingWorkspace = workspacesSnapshot.items.find(item => pathKey(item.path) === targetKey)
    if (existingWorkspace !== undefined) {
      ctx.uiWorkspace.startSession(existingWorkspace.workspaceId)
      return
    }

    if (readSwitchSessionDirectory()) {
      const repoRoot = await resolveRepoRootForWorktree(path, options?.repoRoot)
      // Hopping back to an unregistered main repository checkout never needs
      // session-directory switching: register the repository workspace directly.
      if (repoRoot !== undefined && pathKey(repoRoot) === targetKey) {
        const workspace = await ctx.workspaces.create({ path })
        ctx.uiWorkspace.startSession(workspace.workspaceId)
        return
      }

      const sessionsApi = ctx.sessions as typeof ctx.sessions & {
        create?: (opts?: { workspaceId?: WorkspaceId; cwd?: string; sessionId?: SessionId }) => Promise<SessionId>
        refreshProjections?: (sessionId: SessionId) => Promise<void>
      }
      const uiWs = ctx.uiWorkspace as typeof ctx.uiWorkspace & {
        openSession?: (sessionId: SessionId) => void
      }

      if (options?.reuseBlankSessionId !== undefined && options.reuseBlankSessionId.length > 0) {
        const blankId = options.reuseBlankSessionId as SessionId
        // Withdraw any pending official or plugin deferred worktree request on
        // this reused blank session so sending the first message never creates
        // another worktree inside the directory we are switching into.
        cancelOfficialWorktree(blankId)
        await requestDeferredWorktreeAction(options.reuseBlankSessionId, 'cancel').catch(() => {})
        armedDeferredSessions.delete(options.reuseBlankSessionId)
        notifyDeferredWorktreeState(options.reuseBlankSessionId, null)
        const moved = await requestSetSessionDirectory(options.reuseBlankSessionId, path)
        if (!moved.ok) throw new Error(moved.error)
        void sessionsApi.refreshProjections?.(blankId).catch(() => {})
        void gitCache.refresh([path])
        return
      }

      if (typeof sessionsApi.create === 'function' && typeof uiWs.openSession === 'function') {
        if (repoRoot !== undefined) {
          const existingParent = workspacesSnapshot.items.find(
            item => pathKey(item.path) === pathKey(repoRoot),
          )
          if (existingParent !== undefined) {
            const reusableBlank = findReusableBlankSessionInWorktree(
              {
                workspaceId: existingParent.workspaceId as string,
                path: existingParent.path,
                sessionIds: existingParent.sessionIds as readonly string[],
              },
              path,
              ctx.sessions.list.getSnapshot() as SessionListSnapshotLike,
              workspacesSnapshot.archivedSessionIds as readonly string[],
            )
            if (reusableBlank !== undefined) {
              const reusableId = reusableBlank as SessionId
              cancelOfficialWorktree(reusableId)
              uiWs.openSession(reusableId)
              void gitCache.refresh([path])
              return
            }
          }
          const parentWorkspace = existingParent ?? await ctx.workspaces.create({ path: repoRoot })
          const newSessionId = await sessionsApi.create({ workspaceId: parentWorkspace.workspaceId })
          cancelOfficialWorktree(newSessionId)
          const moved = await requestSetSessionDirectory(newSessionId as string, path)
          if (!moved.ok) throw new Error(moved.error)
          uiWs.openSession(newSessionId)
          void sessionsApi.refreshProjections?.(newSessionId).catch(() => {})
          void gitCache.refresh([path])
          return
        }
      }
    }

    const workspace = await ctx.workspaces.create({ path })
    ctx.uiWorkspace.startSession(workspace.workspaceId)
  }

  const armDeferredWorktree = async (spec: DeferredWorktreeSpec, options?: AdoptWorktreeOptions): Promise<void> => {
    const sessionsApi = ctx.sessions as typeof ctx.sessions & {
      create?: (opts?: { workspaceId?: WorkspaceId; cwd?: string; sessionId?: SessionId }) => Promise<SessionId>
    }
    const uiWs = ctx.uiWorkspace as typeof ctx.uiWorkspace & {
      openSession?: (sessionId: SessionId) => void
    }

    if (options?.reuseBlankSessionId !== undefined && options.reuseBlankSessionId.length > 0) {
      const blankId = options.reuseBlankSessionId as SessionId
      cancelOfficialWorktree(blankId)
      const armed = await requestArmDeferredWorktree({
        sessionId: options.reuseBlankSessionId,
        repoPath: spec.repoPath,
        branch: spec.branch,
        cutout: spec.cutout,
        ...(spec.name === undefined ? {} : { name: spec.name }),
        ...(spec.random === undefined ? {} : { random: spec.random }),
      })
      if (!armed.ok) throw new Error(armed.error)
      armedDeferredSessions.add(options.reuseBlankSessionId)
      notifyDeferredWorktreeState(options.reuseBlankSessionId, armed.state)
      return
    }

    if (typeof sessionsApi.create !== 'function' || typeof uiWs.openSession !== 'function') {
      throw new Error('Host does not support deferred session worktree creation')
    }
    const repoRoot = await resolveRepoRootForWorktree(spec.repoPath, options?.repoRoot)
    if (repoRoot === undefined) {
      throw new Error('Could not resolve repository root for deferred worktree creation')
    }
    const workspacesSnapshot = ctx.workspaces.list.getSnapshot()
    const existingParent = workspacesSnapshot.items.find(
      item => pathKey(item.path) === pathKey(repoRoot),
    )

    // If the user is already viewing an unarchived, unarmed blank session on
    // this exact main repository checkout, arm it in place instead of spawning
    // a second blank session under the same repository workspace.
    if (existingParent !== undefined) {
      const sessionsSnap = ctx.sessions.list.getSnapshot() as SessionListSnapshotLike
      const archived = new Set(workspacesSnapshot.archivedSessionIds as readonly string[])
      const activeMainId = Object.entries(sessionsSnap.byId).find(
        ([, summary]) => (summary?.retainedBy?.mainView ?? 0) > 0,
      )?.[0]
      if (
        activeMainId !== undefined
        && !archived.has(activeMainId)
        && (existingParent.sessionIds as readonly string[]).includes(activeMainId)
      ) {
        const activeSummary = sessionsSnap.byId[activeMainId]
        const activeDir = selectSessionDirectory(sessionsSnap, activeMainId)
        if (
          activeSummary?.blank === true
          && activeSummary.origin !== 'subagent'
          && activeDir !== undefined
          && pathKey(activeDir) === pathKey(repoRoot)
        ) {
          const currentDeferred = await fetchDeferredWorktree(activeMainId)
          if (currentDeferred.ok && currentDeferred.state === null) {
            const activeSessionId = activeMainId as SessionId
            cancelOfficialWorktree(activeSessionId)
            const armed = await requestArmDeferredWorktree({
              sessionId: activeMainId,
              repoPath: spec.repoPath,
              branch: spec.branch,
              cutout: spec.cutout,
              ...(spec.name === undefined ? {} : { name: spec.name }),
              ...(spec.random === undefined ? {} : { random: spec.random }),
            })
            if (!armed.ok) throw new Error(armed.error)
            armedDeferredSessions.add(activeMainId)
            notifyDeferredWorktreeState(activeMainId, armed.state)
            return
          }
        }
      }
    }

    const parentWorkspace = existingParent ?? await ctx.workspaces.create({ path: repoRoot })
    const newSessionId = await sessionsApi.create({ workspaceId: parentWorkspace.workspaceId })
    cancelOfficialWorktree(newSessionId)
    const armed = await requestArmDeferredWorktree({
      sessionId: newSessionId as string,
      repoPath: spec.repoPath,
      branch: spec.branch,
      cutout: spec.cutout,
      ...(spec.name === undefined ? {} : { name: spec.name }),
      ...(spec.random === undefined ? {} : { random: spec.random }),
    })
    if (!armed.ok) throw new Error(armed.error)
    armedDeferredSessions.add(newSessionId as string)
    notifyDeferredWorktreeState(newSessionId as string, armed.state)
    uiWs.openSession(newSessionId)
  }

  const chipInjected = (): BranchChipInjected => ({
    adoptWorktree,
    isSwitchSessionDirectory: readSwitchSessionDirectory,
    armDeferredWorktree,
    describeWorktreeRemoval: (path) => {
      const facts = ownershipFacts(path)
      return { running: facts.running, archiveCount: facts.archiveIds.length }
    },
    // The menu's removal confirm runs the SAME shared flow as the manager
    // dialog and the lazy prune (git first, archives and unregistration
    // after), so the three surfaces cannot drift apart.
    removeWorktree: async (path, force) => {
      const facts = ownershipFacts(path)
      await removeWorktreeFully(
        {
          removeWorktree: async (target, targetForce) => {
            const result = await requestRemoveWorktree(target, targetForce)
            if (!result.ok) throw new Error(result.error)
          },
          probeDirectories: async (paths) => {
            const result = await requestPathExists(paths)
            return result.ok ? { exists: result.exists } : undefined
          },
          archiveSession: (sessionId) => ctx.workspaces.archiveSession(sessionId as SessionId),
          deleteWorkspace: (workspaceId) => ctx.workspaces.delete(workspaceId as WorkspaceId),
        },
        {
          path,
          force,
          ...facts.workspaceId === undefined ? {} : { workspaceId: facts.workspaceId },
          archiveSessionIds: facts.archiveIds,
        },
      )
    },
    openGraphByDefault: () => {
      if (openGraphRef !== undefined) return openGraphRef.get() === true
      const section = groupingForm.getSnapshot()
      return section.status === 'ready' && section.value?.openGraphByDefault === true
    },
    // The lazy auto-prune, fired by the chip after a creation fully lands.
    // Everything here is a browser-side fact: the switches ride SyncedConfig
    // on 0.2.2+ hosts (falling back to the settings scope on older hosts), the
    // cap counts valid scan entries only (orphans never count and never go),
    // and activity/running/archive ownership resolves across both standalone
    // workspaces and shared-workspace sessions via effective workingDirectory.
    pruneWorktrees: async (createdPath) => {
      const section = (autoPruneRef === undefined || keepWorktreesRef === undefined)
        ? groupingForm.getSnapshot()
        : undefined
      const autoPrune = autoPruneRef !== undefined
        ? autoPruneRef.get() === true
        : (section !== undefined && section.status === 'ready' && (section.value?.autoPruneWorktrees ?? false) === true)
      if (!autoPrune) return undefined
      const keep = keepWorktreesRef !== undefined
        ? (keepWorktreesRef.get() ?? 30)
        : (section?.status === 'ready' ? (section.value?.keepWorktrees ?? 30) : 30)
      const workspaces = ctx.workspaces.list.getSnapshot()
      const scan = await requestWorktreesAll(workspaces.items.map(workspace => workspace.path))
      if (!scan.ok) return undefined
      const sessions = ctx.sessions.list.getSnapshot() as SessionListSnapshotLike
      const workspaceRows = workspaces.items.map(workspace => ({
        workspaceId: workspace.workspaceId as string,
        path: workspace.path,
        sessionIds: workspace.sessionIds as readonly string[],
      }))
      const archivedIds = workspaces.archivedSessionIds as readonly string[]
      const activity: Record<string, number> = {}
      const workspaceIdByPath = new Map<string, string>()
      const archiveIdsByPath = new Map<string, string[]>()
      const exclude = new Set<string>([pathKey(createdPath)])

      // Exclude official `.agents/worktrees` from automatic pruning even when
      // official worktree management is enabled in the manager modal.
      const validPaths = scan.worktrees
        .filter(entry => entry.repoName !== null && entry.source !== 'official')
        .map(entry => entry.path)
      for (const worktreePath of validPaths) {
        const key = pathKey(worktreePath)
        const owned = collectWorktreeOwnership(worktreePath, workspaceRows, sessions, archivedIds)
        if (owned.running) exclude.add(key)
        if (owned.workspaceId !== undefined) workspaceIdByPath.set(key, owned.workspaceId)
        activity[key] = owned.activity
        archiveIdsByPath.set(key, owned.archiveIds)
      }

      // Exclude whichever directory the main-view session currently works in
      // (reads projected `workingDirectory` first so shared-workspace sessions
      // protect their active worktree).
      const mainSessionId = Object.entries(sessions.byId).find(
        ([, summary]) => (summary?.retainedBy?.mainView ?? 0) > 0,
      )?.[0]
      const currentCwd = mainSessionId === undefined ? undefined : selectSessionDirectory(sessions, mainSessionId)
      if (currentCwd !== undefined) exclude.add(pathKey(currentCwd))

      const plan = planPrune({
        paths: validPaths,
        activity,
        keep,
        exclude,
      })
      const targets = plan.map((path) => {
        const key = pathKey(path)
        const workspaceId = workspaceIdByPath.get(key)
        return {
          path,
          force: false,
          ...(workspaceId === undefined ? {} : { workspaceId }),
          archiveSessionIds: archiveIdsByPath.get(key) ?? [],
        }
      })
      const report = await runAutoPrune({
        inspectWorktree: async (path) => {
          const result = await requestInspectWorktree(path)
          if (!result.ok) throw new Error(result.error)
          return { dirty: result.dirty }
        },
        removeWorktree: async (path, force) => {
          const result = await requestRemoveWorktree(path, force)
          if (!result.ok) throw new Error(result.error)
        },
        probeDirectories: async (paths) => {
          const result = await requestPathExists(paths)
          return result.ok ? { exists: result.exists } : undefined
        },
        archiveSession: (sessionId) => ctx.workspaces.archiveSession(sessionId as SessionId),
        deleteWorkspace: (workspaceId) => ctx.workspaces.delete(workspaceId as WorkspaceId),
      }, targets)
      // The run lands in the settings card's 清理记录 (browser-local): the
      // removed directories carry the belonging the scan knew, so the
      // record reads "which project lost which worktrees", not bare paths.
      if (report.removed.length + report.skippedDirty.length + report.failed.length > 0) {
        const detail = new Map(scan.worktrees.map(entry => [pathKey(entry.path), entry]))
        recordPruneRun({
          at: Date.now(),
          removed: report.removed.map((path) => {
            const entry = detail.get(pathKey(path))
            return { path, repoName: entry?.repoName ?? '', branch: entry?.branch ?? '' }
          }),
          skippedDirty: report.skippedDirty,
          failed: report.failed,
        })
      }
      return report
    },
  })

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'git-worktree',
    order: 5,
    locale: NS,
    inject: chipInjected,
  }, BranchChipDock))

  // Composer-top dock card for deferred worktree creation in shared-workspace
  // mode: shows armed status (with Cancel), live creation steps, and failure
  // recovery (Retry / Continue without worktree).
  const handledCompletions = new Set<string>()
  const onDeferredCompleted = (sessionId: string, completed: DeferredWorktreeCompleted): void => {
    armedDeferredSessions.delete(sessionId)
    const key = `${sessionId}\0${pathKey(completed.path)}`
    if (handledCompletions.has(key)) return
    handledCompletions.add(key)
    const sessionsApi = ctx.sessions as typeof ctx.sessions & {
      refreshProjections?: (id: SessionId) => Promise<void>
    }
    void sessionsApi.refreshProjections?.(sessionId as SessionId).catch(() => {})
    void gitCache.refresh([completed.path])
    const t = ctx.locale.bind(NS)
    if (completed.fetchWarning !== undefined) emitToast(t('fetchWarning', { message: completed.fetchWarning }))
    if (completed.excludeWarning !== undefined) emitToast(t('excludeWarning', { message: completed.excludeWarning }))
    if (completed.copyWarning !== undefined) emitToast(t('copyWarning', { message: completed.copyWarning }))
    const prune = chipInjected().pruneWorktrees
    if (prune !== undefined) {
      void prune(completed.path).then((report) => {
        if (report === undefined) return
        if (report.removed.length > 0) emitToast(t('pruneDone', { n: report.removed.length }))
        if (report.failed.length > 0) emitToast(t('pruneFailed', { n: report.failed.length }))
      }).catch(() => { /* auto-prune must not disrupt an active turn */ })
    }
  }
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'git-worktree-deferred',
    order: 5,
    locale: NS,
    inject: () => ({
      shouldProbeDeferred: (sessionId: string) => readSwitchSessionDirectory() || armedDeferredSessions.has(sessionId),
      onDeferredCompleted,
    }),
  }, DeferredWorktreeDock))

  // Shadow official top-right `forge-panel.worktree` in blank sessions when
  // `hideOfficialWorktreeEntry` is enabled (default true); dynamically releases
  // the override when the user turns the switch off in plugin settings.
  let pluginDisposed = false
  let officialEntryDisposer: (() => void) | undefined
  const syncOfficialEntryOverride = (): void => {
    if (pluginDisposed) return
    const shouldHide = readHideOfficialEntry()
    if (shouldHide && officialEntryDisposer === undefined) {
      officialEntryDisposer = ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
        name: 'conversation.hero.options',
        id: OFFICIAL_WORKTREE_SLOT_ID,
        priority: -10,
        inject: () => ({ cancelOfficialWorktree }),
      }, HiddenOfficialWorktreeEntry))
    } else if (!shouldHide && officialEntryDisposer !== undefined) {
      officialEntryDisposer()
      officialEntryDisposer = undefined
    }
  }
  syncOfficialEntryOverride()
  const unsubHideOfficialSynced = hideOfficialRef?.subscribe(syncOfficialEntryOverride)
  const unsubHideOfficialForm = groupingForm.subscribe(syncOfficialEntryOverride)
  ctx.effect(() => () => {
    unsubHideOfficialSynced?.()
    unsubHideOfficialForm()
    officialEntryDisposer?.()
    officialEntryDisposer = undefined
  }, 'git-worktree: official worktree entry override lifecycle')

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'git-worktree-toasts',
    order: 20,
  }, WorktreeToastHost))

  let lastSyncedPathSignature = ''
  const syncWorkspaceGitFacts = (): void => {
    const workspaces = ctx.workspaces.list.getSnapshot()
    const sessions = ctx.sessions.list.getSnapshot() as SessionListSnapshotLike
    const archived = new Set(workspaces.archivedSessionIds as readonly string[])
    const seen = new Map<string, string>()
    for (const workspace of workspaces.items) {
      if (workspace.path.length > 0) seen.set(pathKey(workspace.path), workspace.path)
    }
    for (const sessionId of Object.keys(sessions.byId)) {
      if (archived.has(sessionId)) continue
      const dir = selectSessionDirectory(sessions, sessionId)
      if (dir !== undefined && dir.length > 0) seen.set(pathKey(dir), dir)
    }
    const signature = [...seen.keys()].sort().join('\0')
    if (signature === lastSyncedPathSignature) return
    lastSyncedPathSignature = signature
    void gitCache.syncPaths([...seen.values()], true)
  }
  const resolveSessionPathFromCtx = (sessionId: string): string | undefined =>
    resolveEffectiveSessionPath(
      ctx.sessions as unknown as SessionsDirectorySourceLike,
      sessionId,
      ctx.workspaces.list.getSnapshot().items.map(item => ({
        workspaceId: item.workspaceId as string,
        path: item.path,
        sessionIds: item.sessionIds as readonly string[],
      })),
    )
  syncWorkspaceGitFacts()
  const unsubscribeWorkspaces = isObservable(ctx.workspaces.list)
    ? ctx.workspaces.list.subscribe(syncWorkspaceGitFacts)
    : undefined
  const unsubscribeSessions = isObservable(ctx.sessions.list)
    ? ctx.sessions.list.subscribe(syncWorkspaceGitFacts)
    : undefined
  ctx.effect(() => () => {
    pluginDisposed = true
    unsubscribeWorkspaces?.()
    unsubscribeSessions?.()
    gitCache.dispose()
  }, 'git-worktree: workspace git cache lifecycle')

  // The Plugins configuration tab dispatches keyed cards for the namespaces
  // the Host serves; the git-worktree host half registers this key, so the
  // storage-root card pairs with it without any upstream change. One bind
  // backs both the card form (checkbox reads the snapshot) and the sidebar
  // seat (subscribe drives register/dispose).
  // The worktree manager dialog's face: scan/inspect ride the plugin routes,
  // workspace/session shapes ride the live service snapshots — the component
  // itself stays ctx-free (same discipline as the sidebar's injected face).
  const managerFace = (): WorktreeManagerFace => ({
    listWorktrees: async () => {
      const result = await requestWorktreesAll(ctx.workspaces.list.getSnapshot().items.map(workspace => workspace.path))
      if (!result.ok) throw new Error(result.error)
      return {
        worktrees: result.worktrees,
        legacyRoot: result.legacyRoot,
        legacyRootExists: result.legacyRootExists,
        ...result.truncated === undefined ? {} : { truncated: result.truncated },
      }
    },
    // Legacy half only: no workspaces means the scan never touches the
    // project layouts — one cheap directory read answers the card's row.
    describeStorage: async () => {
      const result = await requestWorktreesAll()
      if (!result.ok) throw new Error(result.error)
      return { legacyRoot: result.legacyRoot, legacyRootExists: result.legacyRootExists }
    },
    inspectWorktree: async (path) => {
      const result = await requestInspectWorktree(path)
      if (!result.ok) throw new Error(result.error)
      return { dirty: result.dirty, ahead: result.ahead }
    },
    workspaces: () => ctx.workspaces.list.getSnapshot().items.map(workspace => ({
      workspaceId: workspace.workspaceId as string,
      path: workspace.path,
      sessionIds: workspace.sessionIds as readonly string[],
    })),
    sessionById: (sessionId) => {
      const summary = ctx.sessions.list.getSnapshot().byId[sessionId as SessionId]
      if (summary === undefined) return undefined
      return {
        running: summary.running,
        blank: summary.blank,
        ...(summary.origin === 'subagent' ? { origin: 'subagent' as const } : {}),
        updatedAt: summary.updatedAt,
      }
    },
    archivedSessionIds: () => ctx.workspaces.list.getSnapshot().archivedSessionIds,
    removeWorktree: async (path, force) => {
      const result = await requestRemoveWorktree(path, force)
      if (!result.ok) throw new Error(result.error)
    },
    probeDirectories: async (paths) => {
      const result = await requestPathExists(paths)
      return result.ok ? { exists: result.exists } : undefined
    },
    purgeDirectory: async (path) => {
      const result = await requestPurgeDirectory(path)
      if (!result.ok) throw new Error(result.error)
    },
    archiveSession: (sessionId) => ctx.workspaces.archiveSession(sessionId as SessionId),
    deleteWorkspace: (workspaceId) => ctx.workspaces.delete(workspaceId as WorkspaceId),
    describeWorktreeOwnership: (path) => ownershipFacts(path),
    openWorktree: async (path, repoRoot) => {
      await adoptWorktree(path, repoRoot === undefined ? undefined : { repoRoot })
    },
    onWorktreeRemoved: (path) => {
      gitCache.invalidate(path)
    },
  })

  // Root overlay host for dialogs opened from native sidebar/header menus
  // (manage scoped to a repository, create from branch, guarded remove).
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'git-worktree-actions',
    order: 18,
    locale: NS,
    inject: () => {
      const chip = chipInjected()
      return {
        manager: managerFace(),
        adoptWorktree: chip.adoptWorktree,
        isSwitchSessionDirectory: chip.isSwitchSessionDirectory,
        armDeferredWorktree: chip.armDeferredWorktree,
        describeWorktreeRemoval: chip.describeWorktreeRemoval,
        removeWorktree: chip.removeWorktree,
        pruneWorktrees: chip.pruneWorktrees,
        onWorktreeCreated: (path: string) => { void gitCache.refresh([path]) },
        onWorktreeRemoved: (path: string) => { gitCache.invalidate(path) },
      }
    },
  }, WorktreeActionHost))

  // Native sidebar decorations for linked worktree sessions (DSH 0.2.2-rc.5+):
  // trailing branch badge and hover card repository/branch identity.
  // Covers both standalone worktree Workspaces and shared-workspace sessions
  // switched into a worktree (since the host exposes session-row slots rather
  // than a workspace-row trailing slot), while yielding when official
  // `forgeWorktree` already owns the session decoration.
  const sessionMenuInjected = () => ({
    gitCache,
    resolveSessionPath: resolveSessionPathFromCtx,
  })
  const badgeInjected = () => ({
    gitCache,
    resolveSessionPath: resolveSessionPathFromCtx,
    sessionsObservable: isObservable(ctx.sessions.list) ? ctx.sessions.list : undefined,
    shouldDecorateSession: (sessionId: string): boolean => {
      const sessions = ctx.sessions.list.getSnapshot() as SessionListSnapshotLike
      return !hasForgeManagedWorktree(sessions, sessionId)
    },
  })
  ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register({
    name: 'sidebar.session.row.trailing',
    id: 'git-worktree',
    order: 10,
    locale: NS,
    inject: badgeInjected,
  }, SidebarWorktreeTrailing))
  ctx.slots.inject('sidebar.session.row.hover', () => ctx.slots.register({
    name: 'sidebar.session.row.hover',
    id: 'git-worktree',
    order: 20,
    locale: NS,
    inject: badgeInjected,
  }, SidebarWorktreeHover))

  // Legacy session menu fallback for hosts without `ctx.contextMenus`. Disposed
  // automatically while native `ctx.contextMenus` is active to prevent duplicate items.
  let legacyMenuDisposer: (() => void) | undefined
  const mountLegacySessionMenu = (): void => {
    if (pluginDisposed || legacyMenuDisposer !== undefined) return
    legacyMenuDisposer = ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
      name: 'sidebar.workspaces.session.menu.item',
      id: 'git-worktree-remove',
      order: 500,
      locale: NS,
      inject: sessionMenuInjected,
    }, LegacySessionMenuItem))
  }
  const unmountLegacySessionMenu = (): void => {
    legacyMenuDisposer?.()
    legacyMenuDisposer = undefined
  }
  mountLegacySessionMenu()
  ctx.effect(() => unmountLegacySessionMenu, 'git-worktree: legacy session menu lifecycle')

  // Optional structured context menus (`workspace`, `session`, `sessionHeader`)
  // on hosts that provide `contextMenus` (DSH >= 0.2.2-rc.5).
  if (typeof ctx.inject === 'function') {
    const injectOptional = ctx.inject.bind(ctx) as (
      deps: readonly string[],
      callback: (scope: ClientContext) => void,
    ) => unknown
    injectOptional(['contextMenus'], (menuCtx) => {
      if (!hasContextMenus(menuCtx)) return
      unmountLegacySessionMenu()
      const icons = [
        [CONTEXT_MENU_ICON_KEYS.create, IconBranchOutlineRegular],
        [CONTEXT_MENU_ICON_KEYS.manage, IconFolderCloseRegular],
        [CONTEXT_MENU_ICON_KEYS.remove, IconTrashOutlineRegular],
      ] as const
      const iconDisposer = menuCtx.slots.inject('contextMenu.icon', function* () {
        for (const [key, Icon] of icons) {
          yield menuCtx.slots.register({ name: 'contextMenu.icon', key }, Icon)
        }
      })
      const extraObservers: SnapshotObservable<unknown>[] = []
      if (isObservable(ctx.locale)) extraObservers.push(ctx.locale)
      if (isObservable(ctx.sessions.list)) extraObservers.push(ctx.sessions.list)
      if (isObservable(ctx.workspaces.list)) extraObservers.push(ctx.workspaces.list)
      const menuDisposer = registerNativeContextMenus({
        contextMenus: menuCtx.contextMenus,
        gitCache,
        resolveSessionPath: resolveSessionPathFromCtx,
        t: ctx.locale.bind(NS),
        extraObservers,
      })
      menuCtx.effect(() => () => {
        menuDisposer()
        iconDisposer()
        mountLegacySessionMenu()
      }, 'git-worktree: native context menus')
    })
  }

  const form = new CardForm(groupingForm)
  const store = form.bind()
  // The Plugins page dispatches a bundle's own configuration by the bundle's
  // PACKAGE NAME (this package — see cordis.patch.yml), rendered on the
  // bundle's page under `view: 'page'` and previewed under 'summary'. The
  // registration follows the served-namespace directory through the shared
  // describe face: a deployment whose Host half is not composed (the
  // `git-worktree` namespace unserved) shows no trace of the card, and a
  // late-arriving Host registration still picks it up.
  const describeFace = ctx.configForms.describe()
  let configDisposer: (() => void) | undefined
  const syncCardSeat = (): void => {
    const snapshot = describeFace.getSnapshot()
    const served = snapshot.status === 'ready'
      && (snapshot.view?.namespaces.some(entry => entry.ns === GIT_WORKTREE_NS) ?? false)
    if (served && configDisposer === undefined) {
      configDisposer = ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: PLUGIN_PACKAGE,
        locale: NS,
        inject: () => ({
          hooks: { gitWorktreeCard: store },
          ...form.actions(),
          manager: managerFace(),
        }),
      }, GitWorktreeCard))
    } else if (!served && configDisposer !== undefined) {
      configDisposer()
      configDisposer = undefined
    }
  }
  const unsubscribeDescribe = describeFace.subscribe(syncCardSeat)
  void describeFace.ensure()
  syncCardSeat()
  ctx.effect(() => () => {
    unsubscribeDescribe()
    if (configDisposer !== undefined) configDisposer()
  }, 'git-worktree: plugin config card lifecycle')
}
