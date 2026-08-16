/**
 * dsh-git-worktree browser half: the composer branch chip + worktree toggle
 * (conversation.input.left) for blank sessions, and the settings section
 * (settings.section). Data flows through the host half's own routes; session
 * hopping uses the framework's workspaces service.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (input region entries).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-settings SlotMap merge (settings.section entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { BranchChipDock } from './BranchChip.tsx'
import { WorktreeSettingsSection } from './SettingsSection.tsx'
import { en, zh, type GitWorktreeKey } from './locales.ts'
import type { BranchChipInjected, SettingsSectionInjected } from './slots.ts'

export type { BranchChipInjected, SettingsSectionInjected } from './slots.ts'
export type { GitWorktreeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The git-worktree chip, dialogs, and settings section copy. */
    'git-worktree': GitWorktreeKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'git-worktree'

/** Required services: slot ledger, session/workspace runtime, and copy. */
export const inject = ['slots', 'sessions', 'workspaces', 'locale']

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

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'git-worktree',
    order: 40,
    label: () => ctx.locale.bind(NS)('settingsNav'),
    locale: NS,
    inject: (): SettingsSectionInjected => ({
      pickDirectory: () => ctx.workspaces.pickDirectory(),
    }),
  }, WorktreeSettingsSection))
}
