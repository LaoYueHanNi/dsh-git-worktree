/**
 * Injected business faces: framework actions the entries themselves cannot
 * reach (workspace registration and directory picking live on the workspaces
 * service, injected through the client plugin context).
 */

export interface BranchChipInjected {
  /**
   * Register a created/reused worktree directory as a real Workspace and hop
   * to its blank session (draft carried by the framework's connect flow).
   * The workspace title defaults to the folder basename, which the host side
   * already names `<repoName>-<branch>` — belonging needs no extra rename.
   * @param path - absolute worktree directory.
   */
  adoptWorktree: (path: string) => Promise<void>
}
