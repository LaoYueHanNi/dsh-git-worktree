/**
 * dsh-git-worktree browser half: the composer branch chip + worktree toggle
 * (conversation.input.left) for blank sessions, the plugin configuration
 * card on the Plugins tab (the `git-worktree` settings namespace — the
 * worktree storage root — edited through the settings scope), and — while
 * the sidebar-grouping switch is on — the `sidebar.workspaces` occupant
 * that clusters same-repository workspaces into one tree. Repo facts and
 * worktree creation flow through the host half's own routes; session hopping
 * uses the framework's workspaces service; the card's browse button rides the
 * same service's native directory picker (`ctx.workspaces.pickDirectory`).
 *
 * The grouping seat registers DYNAMICALLY: the settings scope drives a
 * register/dispose cycle, so flipping the card's switch swaps the sidebar
 * browser without a page reload (the native browser owns the default cell,
 * this entry shadows it at a lower priority while enabled).
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
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
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { BranchChipDock } from './BranchChip.tsx'
import { CardForm, type SectionValue } from './card-form.ts'
import { GitWorktreeCard } from './GitWorktreeCard.tsx'
import { GroupedSidebar, type GroupedSidebarInjected } from './GroupedSidebar.tsx'
import { requestGroupWorktrees } from './api.ts'
import { en, zh, type GitWorktreeKey } from './locales.ts'
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
 * Namespace of the git-worktree settings section. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
const GIT_WORKTREE_NS = 'git-worktree'

/** Required services: the slot ledger, session/workspace runtime, copy, and
 * the settings scope backing the plugin configuration card. */
export const inject = ['slots', 'sessions', 'workspaces', 'locale', 'connection', 'remote', 'settingsScope']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'git-worktree: dictionaries')

  const chipInjected = (): BranchChipInjected => ({
    adoptWorktree: async (path) => {
      const workspace = await ctx.workspaces.create({ path })
      ctx.workspaces.startSession(workspace.workspaceId)
    },
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
  // stores the document. Enable waits until GroupedSidebar's first /group
  // probe settles (until then the tree is visually the native flat list);
  // disable waits until the occupant is disposed and a frame has painted
  // so the native browser can commit. Subscribe still drives apply for
  // startup and out-of-band writes.
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

  const syncGroupingSeat = (): Promise<void> => {
    const snapshot = groupingScope.getSnapshot()
    if (snapshot.status !== 'ready') return seatReady
    const enabled = snapshot.value?.groupSidebar ?? true
    if (enabled === groupingEnabled) return seatReady
    groupingEnabled = enabled
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
    const injectFace = (): GroupedSidebarInjected => ({
      workspacesList: ctx.workspaces.list,
      sessionsList: ctx.sessions.list,
      openSession: (sessionId: string) => {
        ctx.sessions.open(sessionId as SessionId)
      },
      startSession: (workspaceId?: string) => {
        ctx.workspaces.startSession(workspaceId as WorkspaceId | undefined)
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
      createWorkspace: (input) => ctx.workspaces.create(input),
      pickDirectory: () => ctx.workspaces.pickDirectory(),
      hostDescription: (ctx.get('connection') as { hostDescription: GroupedSidebarInjected['hostDescription'] }).hostDescription,
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
      pickDirectory: () => ctx.workspaces.pickDirectory(),
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
