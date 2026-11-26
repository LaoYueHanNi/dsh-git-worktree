The composer tool row gains a branch button: it opens the repository's branch menu, and picking a branch switches in place; tick Worktree on a blank session and the new session starts inside its own Git worktree in the repository, isolated from the main checkout.

## What you can do

- **Inspect and switch branches**: local and remote branches in collapsible groups, `/` folding like folders, with arrows marking how far each row leads or trails its upstream. Picking a branch switches immediately; picking a remote branch checks it out with a tracking branch.
- **Act on any branch**: right-click a row to check out, create, create-and-check-out from it, rename, delete, or copy it; the current branch can fast-forward to its upstream or open the compact push window (pending-commit list, Git tags, force-with-lease, enabled after the remote check).
- **Read the history**: the graph button next to the menu expands the commit graph in place — browsing never checks out, selecting a commit shows its author, date, full message, and file summary; more pages load at the end, and loaded titles and hashes are searchable.
- **Isolate into a worktree**: tick Worktree on a blank session (or right-click a branch and pick Create worktree) and the session starts at `<repo>/.dsh/gitworktree/<branch>` registered as a real workspace, reusing the directory when it already exists; branches held by worktrees collect in the Worktrees group, and Jump to this worktree opens a new session inside. Leave the new branch name blank to get a random `<base>-<4 hex>` name.
- **Stay in one workspace if you prefer**: turn on "Switch worktree directory in current workspace" and worktrees open by moving the session's directory under its repository, as DSH's own worktrees do; a new worktree is created only when you send the first message, with Retry or Continue without worktree if it fails.
- **Checkout PR / MR into a worktree**: pick a PR/MR from the optional Forge candidate list or enter a number / URL to fetch `refs/pull/<id>/head` or `refs/merge-requests/<id>/head` into an isolated worktree without moving the main checkout; existing PR worktrees can be opened directly or synced to the latest commits (auto-syncing clean remote force-pushes, asking before discarding local commits).
- **Sync remotes**: the toolbar refresh fetches every remote and prunes stale tracking branches; pushes and updates show a cancellable floating progress card that survives switching sessions.

## Some limits

- The directory is fixed once a session starts; inside a worktree session the branch menu shows only its own branch — go back to the main repository for the rest.
- Delete worktree first lists uncommitted files and ahead commits; after confirmation it removes the git worktree, archives its sessions, and unregisters the workspace — the branch itself stays. It is disabled while a session is running.
- Every git command runs outside your sessions; the plugin never stashes, rewrites history, or touches the main checkout for you.
- The plugin's configuration page (Settings → Plugins) opens the cross-repository worktree manager; it can also include DSH's own worktrees under `<repo>/.agents/worktrees`, which are never auto-pruned.
- By default the plugin hides DSH's own new-worktree button on blank sessions so there is a single entry; turn the takeover off in the settings to bring it back.
