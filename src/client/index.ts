/**
 * dsh-git-worktree browser half: the composer branch chip + worktree toggle
 * (conversation.input.left) for blank sessions and the plugin configuration
 * card on the Plugins tab (the `git-worktree` settings namespace — the
 * worktree storage root — edited through the settings scope). Repo facts and
 * worktree creation flow through the host half's own routes; adopting a
 * freshly created worktree registers it and starts a session through the
 * framework's uiWorkspace navigation.
 */

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
import { BranchChipDock } from './BranchChip.tsx'
import { CardForm, type SectionValue } from './card-form.ts'
import { GitWorktreeCard } from './GitWorktreeCard.tsx'
import type { WorktreeManagerFace } from './WorktreeManagerModal.tsx'
import { requestEnsureDirectory, requestGroupWorktrees, requestInspectWorktree, requestPathExists, requestPurgeDirectory, requestRemoveWorktree, requestWorktreesAll } from './api.ts'
import { en, zh, type GitWorktreeKey } from './locales.ts'
import { pathKey, freshestUpdatedAt, planPrune, runAutoPrune } from './worktree-prune.ts'
import { removeWorktreeFully } from './worktree-remove-flow.ts'
import { recordPruneRun } from './prune-history.ts'
import type { BranchChipInjected } from './slots.ts'

export type { BranchChipInjected } from './slots.ts'
export type { GitWorktreeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The git-worktree chip, dialogs, and settings card copy. */
    'git-worktree': GitWorktreeKey
  }
}

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

/** Required services: the slot ledger, session/workspace runtimes, the
 * workspace navigation/directory face, copy, and the config forms backing
 * the plugin configuration card. */
export const inject = ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'locale', 'connection', 'remote', 'configForms']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'git-worktree: dictionaries')

  const groupingForm = ctx.configForms.get<SectionValue>(GIT_WORKTREE_NS)

  /** The DSH half of one worktree removal, read from the live snapshots: the
   * workspace registration sitting on the directory, whether any of its
   * sessions is running (the verb withholds), and the archive set —
   * everything visible: not archived, not blank, not a subagent row, the
   * same qualification the manager dialog and the lazy prune share. */
  const removalFacts = (path: string): { running: boolean; workspaceId: string | undefined; archiveIds: string[] } => {
    const workspaces = ctx.workspaces.list.getSnapshot()
    const workspace = workspaces.items.find(item => pathKey(item.path) === pathKey(path))
    if (workspace === undefined) return { running: false, workspaceId: undefined, archiveIds: [] }
    const sessions = ctx.sessions.list.getSnapshot()
    const archived = new Set(workspaces.archivedSessionIds)
    let running = false
    const archiveIds: string[] = []
    for (const sessionId of workspace.sessionIds) {
      const summary = sessions.byId[sessionId as SessionId]
      if (summary === undefined) continue
      if (summary.running) running = true
      if (summary.blank || summary.origin === 'subagent') continue
      if (!archived.has(sessionId)) archiveIds.push(sessionId)
    }
    return { running, workspaceId: workspace.workspaceId as string, archiveIds }
  }

  const chipInjected = (): BranchChipInjected => ({
    adoptWorktree: async (path) => {
      const workspace = await ctx.workspaces.create({ path })
      ctx.uiWorkspace.startSession(workspace.workspaceId)
    },
    describeWorktreeRemoval: (path) => {
      const facts = removalFacts(path)
      return { running: facts.running, archiveCount: facts.archiveIds.length }
    },
    // The menu's removal confirm runs the SAME shared flow as the manager
    // dialog and the lazy prune (git first, archives and unregistration
    // after), so the three surfaces cannot drift apart.
    removeWorktree: async (path, force) => {
      const facts = removalFacts(path)
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
    // The lazy auto-prune, fired by the chip after a creation fully lands.
    // Everything here is a browser-side fact: the switches ride the settings
    // scope, the cap counts valid scan entries only (orphans never count and
    // never go), and activity is the freshest qualifying session's
    // updatedAt — running-session directories, the fresh creation, and the
    // current session's directory are excluded from selection outright.
    pruneWorktrees: async (createdPath) => {
      const section = groupingForm.getSnapshot()
      if (section.status !== 'ready') return undefined
      if ((section.value?.autoPruneWorktrees ?? false) !== true) return undefined
      const keep = section.value?.keepWorktrees ?? 30
      const workspaces = ctx.workspaces.list.getSnapshot()
      const scan = await requestWorktreesAll(workspaces.items.map(workspace => workspace.path))
      if (!scan.ok) return undefined
      const sessions = ctx.sessions.list.getSnapshot()
      const archived = new Set(workspaces.archivedSessionIds)
      const activity: Record<string, number> = {}
      const workspaceIdByPath = new Map<string, string>()
      const archiveIdsByPath = new Map<string, string[]>()
      const exclude = new Set<string>([pathKey(createdPath)])
      for (const workspace of workspaces.items) {
        const key = pathKey(workspace.path)
        workspaceIdByPath.set(key, workspace.workspaceId)
        const archiveIds: string[] = []
        for (const sessionId of workspace.sessionIds) {
          const summary = sessions.byId[sessionId]
          if (summary === undefined) continue
          if (summary.running === true) exclude.add(key)
          // Blank rows hold nothing worth archiving and subagent rows are
          // never the user's to manage — same qualification as the removal
          // flow's archive set.
          if (summary.blank || summary.origin === 'subagent') continue
          if (!archived.has(sessionId)) archiveIds.push(sessionId)
        }
        // The activity figure and the manager dialog's last-use column share
        // one helper, so the two views cannot drift apart.
        activity[key] = freshestUpdatedAt(workspace.sessionIds.map(id => sessions.byId[id]))
        archiveIdsByPath.set(key, archiveIds)
      }
      // Host 0.1.6 dropped `sessions.current` (navigation belongs to view
      // owners): the main-view session is whichever row the main view
      // retains — the same derivation as upstream ui-workspace's
      // mainSessionId.
      const currentCwd = Object.values(sessions.byId).find(
        session => (session.retainedBy.mainView ?? 0) > 0,
      )?.cwd
      if (currentCwd !== undefined) exclude.add(pathKey(currentCwd))
      const plan = planPrune({
        paths: scan.worktrees.filter(entry => entry.repoName !== null).map(entry => entry.path),
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
  })

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
