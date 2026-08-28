/**
 * Local declaration of the `uiWorkspace` client service, introduced by host
 * dsh-v0.1.2-alpha.1 (`packages/client/ui-workspace/src/client/navigation.ts`)
 * when `workspaces` was reduced to pure Workspace rows. Only the members this
 * plugin calls are declared. Remove this file once a host release past
 * 0.1.2-alpha.1 reaches npm and the `dsh-client-*` devDependencies can carry
 * the real declaration packages (its `Context.uiWorkspace` merge would then
 * collide with the shipped one, which is the intended forcing function).
 */

import type { WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-Controller Workspace navigation and directory UI capability. */
    uiWorkspace: {
      /**
       * Start a New Session flow and navigate to its Session.
       * @param workspaceId - explicit target; absent inherits the current or
       * most recent Workspace.
       */
      startSession(workspaceId?: WorkspaceId): void
      /**
       * Open the Host-native directory picker.
       * @returns the selected directory, or null when cancelled.
       */
      pickDirectory(): Promise<string | null>
    }
  }
}
