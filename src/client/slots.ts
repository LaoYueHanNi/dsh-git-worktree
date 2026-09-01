/**
 * Injected business faces: framework actions the entries themselves cannot
 * reach (workspace registration and directory picking live on the workspaces
 * and uiWorkspace services, injected through the client plugin context).
 */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'

export interface BranchChipInjected {
  /**
   * Register a created/reused worktree directory as a real Workspace and hop
   * to its blank session (draft carried by the framework's connect flow).
   * The workspace title defaults to the folder basename, which the host side
   * already names `<repoName>-<branch>` — belonging needs no extra rename.
   * @param path - absolute worktree directory.
   */
  adoptWorktree: (path: string) => Promise<void>
  /**
   * The framework's session-list snapshot store. Host 0.1.2 dropped the
   * `useSessions` standard prop from session-scoped slots; the chip reads the
   * current session's summary (its `cwd`) through this store instead.
   */
  sessionsList: Pick<{
    getSnapshot(): SessionListState
    subscribe(listener: () => void): () => void
  }, 'getSnapshot' | 'subscribe'>
}
