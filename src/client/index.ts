/**
 * dsh-git-worktree browser half: the composer branch chip + worktree toggle
 * (conversation.input.left) for blank sessions, and the plugin configuration
 * card on the Plugins tab (the `git-worktree` settings namespace — the
 * worktree storage root — edited through the settings scope). Repo facts and
 * worktree creation flow through the host half's own routes; session hopping
 * uses the framework's workspaces service; the card's browse button rides the
 * same service's native directory picker (`ctx.workspaces.pickDirectory`).
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (input region entries).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
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
import { en, zh, type GitWorktreeKey } from './locales.ts'
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

  // The Plugins configuration tab dispatches keyed cards for the namespaces
  // the Host serves; the git-worktree host half registers this key, so the
  // storage-root card pairs with it without any upstream change.
  const form = new CardForm(ctx.settingsScope.bind<SectionValue>({ namespace: GIT_WORKTREE_NS }))
  const store = form.bind()
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: GIT_WORKTREE_NS,
    locale: NS,
    inject: () => ({
      hooks: { gitWorktreeCard: store },
      ...form.actions(),
      // The shell's own directory picker (the workspace flows' chooser):
      // resolves the chosen absolute path, or null when the user dismisses.
      pickDirectory: () => ctx.workspaces.pickDirectory(),
    }),
  }, GitWorktreeCard))
}
