/**
 * dsh-git-worktree browser half: the composer branch chip + worktree toggle
 * (conversation.input.left) for blank sessions, the plugin configuration
 * card on the Plugins tab (the `git-worktree` settings namespace — the
 * worktree storage root — edited through the settings scope), and — while
 * the sidebar-grouping switch is on — the `sidebar.workspaces` occupant
 * that clusters same-repository workspaces into one tree. Repo facts and
 * worktree creation flow through the host half's own routes; session hopping
 * uses the framework's uiWorkspace navigation; the card's browse button rides
 * the same service's native directory picker (`ctx.uiWorkspace.pickDirectory`).
 *
 * The grouping seat registers DYNAMICALLY: the settings scope drives a
 * register/dispose cycle, so flipping the card's switch swaps the sidebar
 * browser without a page reload (the native browser owns the default cell,
 * this entry shadows it at a lower priority while enabled). On startup the
 * seat mounts from the last-known switch value mirrored to localStorage, so
 * a refresh renders the grouped tree immediately; the settings document
 * corrects the value once it lands.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the branded Session id host 0.1.2 publishes on the session types
// subpath (the dead dsh-client-runtime used to carry it).
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: the branded Workspace id from the Workspace controller package.
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: the Remote client merge (ctx.remote.$host Host facts) and the
// connection merge, both behind the gateway/connection client faces.
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the ui-conversation SlotMap merge (input region entries).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-sidebar SlotMap merge ('sidebar.workspaces' and its
// SidebarSectionOwnerProps owner share) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the ui-settings SlotMap merge ('settings.section') and the
// settingsScope service declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the ui-settings-plugins keyed-slot declaration
// ('settings.plugin.item') into this program. The value face stays
// uncompromised: cross-plugin collaboration goes through the slot system.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: pulls the ui-session SessionStandardProps merge (sessionId and
// the useSession selector) into this program — host 0.1.2-alpha.4 removed the
// InputZone owner share from the composer input slots, so the session
// identity rides the standard props it declares.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the ui-workspace service merge (ctx.uiWorkspace) into this
// program — host 0.1.2 keeps session start and directory picking there while
// `workspaces` is the pure Workspace-row controller.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the ui-renderer merge (ctx.slots, the SlotRegistry) into
// this program — the slots service Context declaration lives on ui-renderer.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { BranchChipDock } from './BranchChip.tsx'
import { CardForm, type SectionValue } from './card-form.ts'
import { GitWorktreeCard } from './GitWorktreeCard.tsx'
import { GroupedSidebar, type GroupedSidebarInjected } from './GroupedSidebar.tsx'
import { requestEnsureDirectory, requestGroupWorktrees, requestInspectWorktree, requestPathExists, requestRemoveWorktree } from './api.ts'
import { en, zh, type GitWorktreeKey } from './locales.ts'
import { loadGroupSidebarBoot, saveGroupSidebarBoot } from './sidebar-groups.ts'
import type { BranchChipInjected } from './slots.ts'

export type { BranchChipInjected } from './slots.ts'
export type { GitWorktreeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The git-worktree chip, dialogs, and settings card copy. */
    'git-worktree': GitWorktreeKey
  }
  interface SlotMap {
    /**
     * Directory-flow hole under the sidebar browsing region. Declared at
     * runtime by native ui-workspace; this merge only names the key so
     * occupancy probes type-check. This plugin must NOT re-declare the hole
     * (SlotCore throws on a second declarer).
     */
    'sidebar.workspaces.directoryFlow': {
      kind: 'single'
      scope: 'root'
      owner: {
        open: boolean
        busy: boolean
        onPicked: (path: string) => void
        onCancel: () => void
        onError: (message: string) => void
      }
    }
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'git-worktree'

/**
 * The host service stores (ctx.workspaces.list, ctx.sessions.list) expose
 * getSnapshot/subscribe as PROTOTYPE methods of the controller's model
 * instance; a detached method reference loses its receiver and crashes inside
 * React's bare useSyncExternalStore call (the framework's own hooks wrap the
 * source and always call through the object). Every store crosses the inject
 * boundary as a closure-bounded literal instead — the same shape the
 * hand-built hostInfo/directoryFlow sources below already use.
 */
function boundStore<T>(
  source: { getSnapshot(): T; subscribe(listener: () => void): () => void },
): { getSnapshot(): T; subscribe(listener: () => void): () => void } {
  return {
    getSnapshot: () => source.getSnapshot(),
    subscribe: listener => source.subscribe(listener),
  }
}

/**
 * Namespace of the git-worktree settings section. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
const GIT_WORKTREE_NS = 'git-worktree'

/** Required services: the slot ledger, session/workspace runtimes, the
 * workspace navigation/directory face, copy, and the settings scope backing
 * the plugin configuration card. */
export const inject = ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'locale', 'connection', 'remote', 'settingsScope']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'git-worktree: dictionaries')

  const chipInjected = (): BranchChipInjected => ({
    adoptWorktree: async (path) => {
      const workspace = await ctx.workspaces.create({ path })
      ctx.uiWorkspace.startSession(workspace.workspaceId)
    },
    sessionsList: boundStore(ctx.sessions.list),
  })

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'git-worktree',
    order: 5,
    locale: NS,
    inject: chipInjected,
  }, BranchChipDock))

  const groupingScope = ctx.settingsScope.bind<SectionValue>({ namespace: GIT_WORKTREE_NS })

  // Seat apply is a Promise the settings card awaits: `scope.set` only
  // stores the document. Enable waits until GroupedSidebar reports ready
  // (a matching facts cache paints immediately; a cache miss waits for
  // the first /group). Disable waits until the occupant is disposed and
  // a frame has painted so the native browser can commit. Subscribe still
  // drives apply for startup and out-of-band writes.
  //
  // Startup mounts the seat from the LAST-KNOWN switch value (mirrored to
  // localStorage by the boot cache) instead of waiting for the settings
  // document to cross from the Host: without it every refresh renders the
  // native browser first and swaps to the grouped tree seconds later. The
  // ready snapshot remains the authority and corrects a stale cache
  // through the normal change path.
  const SEAT_READY_TIMEOUT_MS = 20_000
  const SNAPSHOT_WAIT_MS = 8_000
  let groupingDisposer: (() => void) | undefined
  let groupingEnabled: boolean | undefined
  let seatEpoch = 0
  let seatReady = Promise.resolve()
  let seatReadyResolve: (() => void) | undefined
  let seatTimer: ReturnType<typeof setTimeout> | undefined

  const finishSeat = (): void => {
    if (seatTimer !== undefined) {
      window.clearTimeout(seatTimer)
      seatTimer = undefined
    }
    const resolve = seatReadyResolve
    seatReadyResolve = undefined
    resolve?.()
  }

  const afterPaint = (): Promise<void> => new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { requestAnimationFrame(() => { resolve() }) })
      return
    }
    setTimeout(resolve, 0)
  })

  const groupingMatches = (enabled: boolean): boolean => {
    const snapshot = groupingScope.getSnapshot()
    return snapshot.status === 'ready' && (snapshot.value?.groupSidebar ?? true) === enabled
  }

  const waitSnapshotMatches = async (enabled: boolean): Promise<void> => {
    if (groupingMatches(enabled)) return
    await new Promise<void>((resolve) => {
      const stop = groupingScope.subscribe(() => {
        if (!groupingMatches(enabled)) return
        stop()
        window.clearTimeout(timer)
        resolve()
      })
      const timer = window.setTimeout(() => {
        stop()
        resolve()
      }, SNAPSHOT_WAIT_MS)
      if (groupingMatches(enabled)) {
        window.clearTimeout(timer)
        stop()
        resolve()
      }
    })
  }

  /** Inject the `sidebar.workspaces` occupant (priority -1 shadows the native
   * browser at priority 0) and arm its readiness epoch. */
  const registerGroupingSeat = (): void => {
    const epoch = ++seatEpoch
    seatReady = new Promise<void>((resolve) => { seatReadyResolve = resolve })
    const injectFace = (): GroupedSidebarInjected => ({
      workspacesList: boundStore(ctx.workspaces.list),
      sessionsList: boundStore(ctx.sessions.list),
      openSession: (sessionId: string) => {
        ctx.sessions.open(sessionId as SessionId)
      },
      startSession: (workspaceId?: string) => {
        ctx.uiWorkspace.startSession(workspaceId as WorkspaceId | undefined)
      },
      loadFacts: async (paths: readonly string[]) => {
        const result = await requestGroupWorktrees(paths)
        return result.ok ? result.facts : undefined
      },
      searchSessions: async (query, signal) => {
        const result = await ctx.sessions.search(query, signal)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      searchResultLimit: ctx.sessions.searchResultLimit,
      renameSession: async (sessionId, title) => {
        const session = ctx.sessions.binding(sessionId as SessionId)?.session
        if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
        const result = await session.rename(title)
        if (!result.ok) throw new Error(result.error.message)
      },
      forkSession: (sessionId) => {
        ctx.sessions.fork({ sessionId: sessionId as SessionId, increaseTitle: true }).then((childId) => {
          ctx.sessions.open(childId)
        }).catch(() => { /* fork failure is silent, matching native */ })
      },
      renameWorkspace: async (workspaceId, title) => {
        await ctx.workspaces.rename(workspaceId as WorkspaceId, title)
      },
      deleteWorkspace: async (workspaceId) => {
        await ctx.workspaces.delete(workspaceId as WorkspaceId)
      },
      archiveSession: async (sessionId) => {
        await ctx.workspaces.archiveSession(sessionId as SessionId)
      },
      inspectWorktree: async (path) => {
        const result = await requestInspectWorktree(path)
        if (!result.ok) throw new Error(result.error)
        return { dirty: result.dirty, ahead: result.ahead }
      },
      removeWorktree: async (path, force) => {
        const result = await requestRemoveWorktree(path, force)
        if (!result.ok) throw new Error(result.error)
      },
      probeDirectories: async (paths) => {
        const result = await requestPathExists(paths)
        return result.ok ? { exists: result.exists, ...result.rebuildable === undefined ? {} : { rebuildable: result.rebuildable } } : undefined
      },
      ensureDirectory: async (path) => {
        const result = await requestEnsureDirectory(path)
        if (!result.ok) throw new Error(result.error)
      },
      createWorkspace: (input) => ctx.workspaces.create(input),
      pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
      // Host facts ride the remote `$host` read (identity-stable
      // RemoteHostFacts) with the connection generation as the invalidation
      // source — the same shape the native browser's `hostInfo` inject hook
      // publishes. Host 0.1.2 removed the old `connection.hostDescription`
      // store; the handle itself keeps no Context merge, hence the cast. The
      // subscribe call is wrapped: method references detached from the
      // generation object lose their receiver.
      hostInfo: (() => {
        const generation = (ctx.get('connection') as {
          generation: { getSnapshot(): unknown; subscribe(listener: () => void): () => void }
        }).generation
        return {
          getSnapshot: () => ctx.remote.$host,
          subscribe: (listener: () => void) => generation.subscribe(listener),
        }
      })(),
      directoryFlow: {
        getSnapshot: () => ctx.slots.entries('sidebar.workspaces.directoryFlow').length > 0,
        subscribe: (listener) => ctx.slots.subscribe('sidebar.workspaces.directoryFlow', listener),
      },
      onReady: () => { if (epoch === seatEpoch) finishSeat() },
    })
    groupingDisposer = ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
      name: 'sidebar.workspaces',
      priority: -1,
      locale: NS,
      inject: injectFace,
    }, GroupedSidebar))
    seatTimer = window.setTimeout(() => { if (epoch === seatEpoch) finishSeat() }, SEAT_READY_TIMEOUT_MS)
  }

  const syncGroupingSeat = (): Promise<void> => {
    const snapshot = groupingScope.getSnapshot()
    if (snapshot.status !== 'ready') {
      // Startup fast path: the settings document has not crossed from the
      // Host yet. Mount from the last-known value immediately (absent = the
      // composition default "on"); the ready snapshot corrects it through
      // the normal change path once it lands.
      if (groupingEnabled === undefined) {
        groupingEnabled = loadGroupSidebarBoot() ?? true
        if (groupingEnabled) registerGroupingSeat()
      }
      return seatReady
    }
    const enabled = snapshot.value?.groupSidebar ?? true
    if (enabled === groupingEnabled) {
      // The Host is the authority: refresh the boot cache so the next
      // startup mounts from the value it actually stored.
      saveGroupSidebarBoot(enabled)
      return seatReady
    }
    groupingEnabled = enabled
    saveGroupSidebarBoot(enabled)
    if (groupingDisposer !== undefined) {
      groupingDisposer()
      groupingDisposer = undefined
    }
    const epoch = ++seatEpoch
    seatReady = new Promise<void>((resolve) => { seatReadyResolve = resolve })
    if (!enabled) {
      void afterPaint().then(() => { if (epoch === seatEpoch) finishSeat() })
      return seatReady
    }
    registerGroupingSeat()
    return seatReady
  }

  const waitForGroupingSeat = async (enabled: boolean): Promise<void> => {
    await waitSnapshotMatches(enabled)
    await syncGroupingSeat()
  }

  // The Plugins configuration tab dispatches keyed cards for the namespaces
  // the Host serves; the git-worktree host half registers this key, so the
  // storage-root card pairs with it without any upstream change. One bind
  // backs both the card form (checkbox reads the snapshot) and the sidebar
  // seat (subscribe drives register/dispose).
  const form = new CardForm(groupingScope, waitForGroupingSeat)
  const store = form.bind()
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: GIT_WORKTREE_NS,
    priority: -1,
    locale: NS,
    inject: () => ({
      hooks: { gitWorktreeCard: store },
      ...form.actions(),
      // The shell's own directory picker (the workspace flows' chooser):
      // resolves the chosen absolute path, or null when the user dismisses.
      pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
    }),
  }, GitWorktreeCard))

  // Native ui-workspace occupies the slot's default cell (priority 0). While
  // the switch is on, this entry shadows it at priority -1 (single cells
  // render their LOWEST live entry), and the disposer restores the native
  // browser the moment the switch flips or the fiber unloads.
  void syncGroupingSeat()
  const unsubscribeGrouping = groupingScope.subscribe(() => { void syncGroupingSeat() })
  ctx.effect(() => () => {
    unsubscribeGrouping()
    if (groupingDisposer !== undefined) groupingDisposer()
  }, 'git-worktree: sidebar grouping lifecycle')
}
