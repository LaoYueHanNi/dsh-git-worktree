# dsh-git-worktree

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

![dsh-git-worktree in the Web UI](gitworktree.png)

[简体中文](./README.zh.md) | English

A dsh plugin for simple branch & worktree management in the Web UI. The composer tool row shows the current branch: pick another to switch in place, or flip the **Worktree** toggle to get an isolated worktree as a real workspace — as shown in the screenshot above.

[dsh]: https://github.com/cordiverse/dsh

Repo: <https://github.com/LaoYueHanNi/dsh-git-worktree>

> [!IMPORTANT]
> **GitHub direct installs have ended** — the repository no longer carries prebuilt output. Install from npm instead:
>
> ```sh
> dsh plugin --profile web add @laoyuehanni/dsh-git-worktree
> ```
>
> **Upgrading from a legacy `github:` install (≤ 0.3.2, package name `dsh-git-worktree`)?** An in-place `update` fails to load — remove the old name first, then add again. Worktree folders and the plugin's settings carry over untouched.

## Features

- **IDEA-style branch picker**: the branch menu treats `/` as a folder hierarchy — collapsible folders, last-segment labels, the checked-out branch's chain opens centered. Local and remote branches render as two collapsible groups (a single remote strips its prefix), with bottom search (ancestor folders kept, hits highlighted), locate-current-branch and expand/collapse tools, and ↑N/↓N divergence marks on tracking branches.
- **Remote branch checkout**: pick `origin/feat-x` in the remote group and confirm — it checks out in place with a tracking branch; the worktree toggle sends the pick to an isolated worktree instead.
- **Worktree quick hop**: the main checkout's blank-session menu groups branches held by live worktrees under **Worktrees** (hover shows the directory) — double-click hops straight into that directory and starts a fresh session.
- **Branch switching**: pick a branch and confirm — an in-place switch. Inside a linked worktree the entry scopes down: other branches stay listed but dimmed, with a hint to act from the main checkout; a started session's menu shows only its own branch (fetch and update still work).
- **In-place branch creation**: the menu toolbar's plus opens a create flyout with as-you-type validation (git ref rules plus a duplicate check); Create cuts and checks out the new branch in one stroke (detached HEAD included), a failure keeps the flyout open for a renamed retry.
- **Remote sync**: the last toolbar tool fetches every remote and prunes stale tracking branches — the list refreshes in place, no terminal round-trip.
- **Branch update**: update the CURRENT branch to its upstream (fast-forward only); divergence, a missing upstream, or conflicting uncommitted changes are refused with git's own explanation — the plugin never stashes or rewrites history on your behalf.
- **Worktree isolation**: on a blank session, the **Worktree** toggle pops the cutout dialog with an editable branch name (pre-filled with the first free `<current>-wt`); confirming cuts it into a fresh isolated worktree that registers as a real workspace. The branch picker stays available — picking another branch creates the worktree under `~/.dsh/gitworktree/<repo>-<branch>/` instead, and same-branch re-picks reuse the existing worktree.
- **Worktree removal**: the ⋯ menu of a worktree row offers **Remove worktree** — the dialog first counts uncommitted files (red) and ahead commits, and warns the workspace's sessions will be archived; confirming removes the worktree, then archives the sessions. A git failure leaves the DSH side untouched and retries in place.
- **Ungrouped virtual directory groups**: sessions no workspace accounts for cluster by directory under a trailing **Ungrouped** section (a dashed folder glyph sets them apart). A cluster matching a registered workspace is marked as its strays; an existing directory registers as a workspace in one click; a vanished slot under the storage root can be rebuilt empty — its historical sessions reattach automatically.
- **Storage root configurable**: the **Git Worktree** card under **Settings → Plugins** — a folder picker or a typed path, effective on save; blank keeps the default `$DSH_HOME/gitworktree`. A legacy `~/.dsh/gitworktree/settings.json` value migrates automatically on upgrade.
- **Sidebar workspace grouping**: the plugin replaces the native sidebar and clusters same-repository workspaces (main checkout plus worktrees) under collapsible repository groups — grouping derives from on-disk git facts, nothing extra is stored. The **Group workspaces** switch (experimental, default on) restores the native list instantly.

  ![Same-repository workspaces grouped in the sidebar](sidebar-grouping.png)

## Install

```sh
dsh plugin --profile web add @laoyuehanni/dsh-git-worktree
```

> The package declares `dsh.bundle`, so `add` wires the plugin into the profile's layer stack automatically — no config editing needed. Requires the `web` profile (`dsh web`) and a dsh **0.1.2-rc.1** (or later 0.1.2) host.

Running a dsh **0.1.2 alpha** host? Install the dedicated compatibility build instead:

```sh
dsh plugin --profile web add @laoyuehanni/dsh-git-worktree@dsh-alpha
```

> `@dsh-alpha` is a dist-tag resolving to the latest alpha-host compatibility build (currently `0.4.3-dsh-0.1.2-alpha.5`) with peers pinned to the alpha line — a plain `update` never mixes the two channels. On 0.1.2-rc.1 or later, use the default line above.

## Update

```sh
dsh plugin --profile web update @laoyuehanni/dsh-git-worktree
```

## Remove

```sh
dsh plugin --profile web remove @laoyuehanni/dsh-git-worktree
```

Worktree folders under `~/.dsh/gitworktree/` are kept; the plugin's own settings live in the dsh settings document.

## Development

Build once, install a symlink, iterate:

```sh
npm install
npm run build && npm run build:client
npm test                # vitest
node scripts/smoke.mjs  # real-git smoke over the built lib
dsh plugin --profile web add link:D:/Code/dsh-worktree
```

Rebuild and restart `dsh web` to apply changes (`npx tsdown --watch` in the plugin directory hot-reloads the client). No `prepare` script by design — `lib/` never enters the repo; `npm publish` builds it fresh into the tarball.

Temporary host-only mount (this launch only, no profile changes): create a `cordis.yml` next to the repo pointing at the built host half (Windows needs the `file:///` form), then launch with it:

```yml
- insert:
    - id: git-worktree
      name: 'file:///D:/Code/dsh-worktree/lib/index.js'
```

```sh
dsh web --patch <plugin-dir>/cordis.yml
```

Only the host half mounts in this mode (the `/plugin/git-worktree/*` routes keep working); for UI work use the `link:` install above.
