# dsh-git-worktree

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

![dsh-git-worktree in the Web UI](gitworktree.png)

[简体中文](./README.zh.md) | English

A dsh plugin for simple branch & worktree management in the Web UI. The composer tool row shows the current branch: pick another to switch in place, or flip the **Worktree** toggle to get an isolated worktree as a real workspace — as shown in the screenshot above.

[dsh]: https://github.com/cordiverse/dsh

Repo: <https://github.com/LaoYueHanNi/dsh-git-worktree>

> [!IMPORTANT]
> **Upgrading from a GitHub install of 0.3.2 or earlier?** Since 0.4.0 the plugin is distributed on npm as `@laoyuehanni/dsh-git-worktree` (the unscoped name was already taken on the registry). A legacy `github:` install **cannot be upgraded with `update`** — the package was renamed, and an in-place update leaves the plugin failing to load. From 0.4.0 on, remove the old package name first, then install again:
>
> ```sh
> dsh plugin --profile web remove dsh-git-worktree
> dsh plugin --profile web add @laoyuehanni/dsh-git-worktree
> ```
>
> Worktree folders under `~/.dsh/gitworktree/` and the plugin's settings are untouched by the migration — everything carries over.

## Features

- **IDEA-style branch picker**: the branch menu treats `/` as a folder hierarchy — collapsible folders, last-segment labels, the checked-out branch's chain opens by default and is centered on open. The list renders in two collapsible groups, **local branches** and **remote branches**; under a single remote the remote group strips its `<remote>/` prefix, with several remotes the full names stay (`origin`/`upstream` become the folder layer). Single click selects a row; double-click or Enter opens the right-side confirm flyout. The left tool strip offers **locate current branch** and **expand/collapse all**; the bottom search keeps the matching branches' ancestor folders and highlights the hit substring. Clipped labels expose the full name on hover. Local branches with an upstream trail **↑N/↓N divergence marks** (hover for the full meaning).
- **Remote branch checkout**: pick `origin/feat-x` in the remote group and confirm — it checks out in place with a tracking local branch `feat-x` created by git's dwim; with the worktree toggle on, the pick creates the twin branch isolated in its own worktree instead.
- **Worktree quick hop**: the main checkout's blank-session branch menu collects the branches held by live worktrees into a「工作树」(Worktrees) group (hover shows the directory path) — **double-click hops the session straight into that directory** and starts a fresh session there. No git action, no confirm; the group hides once a session has started.
- **Branch switching**: pick a branch from the chip's menu and confirm — an in-place `git switch`. Inside a **linked worktree** the whole entry scopes down: a blank session still lists every branch (dimmed), but any branch action (worktree hops and in-place creation included) answers with a hint to start from the main checkout — and the worktree toggle doesn't render there; a started session's menu shows nothing but its own branch (fetch and update-current still work — neither moves the checkout).
- **In-place branch creation**: the branch menu's toolbar plus opens a create flyout right of the card — type the name there (validated as you type against git's ref-name rules plus a duplicate check; an illegal or already-taken name shows an inline error) and press Create: the NEW branch is cut from the session directory's current checkout and checked out in place in one stroke (`git switch -c`), detached HEAD included. A failure toasts and keeps the flyout open for a renamed retry — the worktree-less sibling of the cutout flow.
- **Remote sync**: the branch menu's last toolbar tool fetches every remote and prunes stale tracking branches (`git fetch --all --prune`) — remote-side additions and deletions show up in the list the moment it lands, no terminal round-trip. The menu stays open and refreshes in place; a failure toasts.
- **Branch update**: the solid arrow next to the dashed one updates the CURRENT branch — fetch every remote, then fast-forward it to its upstream (`--ff-only`). A diverged branch, a missing upstream, or conflicting uncommitted changes are refused with git's own explanation; the plugin never stashes or rewrites history on your behalf.
- **Worktree isolation**: on a blank session, checking the **Worktree** toggle pops the cutout dialog right above the chip — the new branch's name is editable there (pre-filled with the first free `<current>-wt`, suffixing past taken names), and confirming cuts it out of the current checkout into a fresh isolated worktree; the chip's branch picker stays available for picking another branch, which turns the pick into `git worktree add` under `~/.dsh/gitworktree/<repo>-<branch>/`. Either way the folder registers as a real workspace with a fresh blank session. Same-branch re-picks reuse the existing worktree; stale registrations recover via `git worktree prune`. Dismissing the confirm and sending the message anyway knowingly stays in the current directory.
- **Worktree removal**: the ⋯ menu of a worktree row in the grouped sidebar gains **Remove worktree** — one confirmed flow that closes the lifecycle. The dialog inspects the folder first (`POST /inspect`): the **uncommitted-file count** in red (those die with the folder), the branch's **ahead count** neutrally (the branch ref survives the removal — nothing is lost), plus a heads-up that the workspace's sessions will be **archived along** (never dumped into Ungrouped; unarchive brings them back). Confirming runs `git worktree remove` first (`--force` rides along when there are uncommitted files; a stale registration prunes instead), and only then archives the sessions and drops the workspace registration — git is the step most likely to fail (locked files on Windows), so leading with it leaves the DSH side untouched and the dialog retries in place. Rows with a running or currently-browsed session don't offer the action (archive or switch away first); the main checkout row never does.
- **Ungrouped virtual directory groups**: the grouped view gains a trailing **Ungrouped** section — sessions no workspace accounts for (leftovers of a deleted-then-recreated registration, or history that appeared after first-boot grouping) cluster by their header cwd into **virtual directory groups** (a dashed folder glyph, one indent step, and a lighter title set them apart from real workspaces at a glance; case-insensitive; a directory renamed long ago still clusters under its old path), hover reveals the full path. A cluster whose directory matches a registered workspace is marked as that workspace's **stray sessions**; an unmatched cluster offers **Register as workspace** in one click **only after the host pre-flights the directory** (new sessions land in it from then on; the old strays stay loose until a re-adoption feature exists). A GONE directory gets one of two treatments: a path sitting directly under the worktree storage root is a slot this plugin planned — hover explains that rebuilding it reattaches the historical sessions automatically (DSH keeps the accounting; membership is a realpath projection), and a one-click **Rebuild empty directory** does exactly that (strictly gated to one level under the root — escaping paths and corrupted cwds are refused); anything else stays action-free with the reason in hover. Either way a bad path never reaches the DSH workspace API.
- **Storage root configurable**: the **Git Worktree** card under **Settings → Plugins** — a native folder picker or a typed absolute path, effective on save (new worktrees land in the new location; existing ones stay put and remain listable/reusable by git). Empty selects the default `$DSH_HOME/gitworktree` (`~/.dsh/gitworktree`). The value lives in the shared dsh settings document; a legacy `~/.dsh/git-worktree/settings.json` value migrates into it automatically on upgrade (the old file is renamed `.migrated` and kept).
- **Sidebar workspace grouping**: because DSH has no multi-workspace grouping API, the plugin replaces the native sidebar 1:1 and clusters same-repository workspaces (main checkout plus worktrees) under a collapsible **repository group**. The main row reads `Main (branch)`, worktree rows read their branch, grouping is derived from on-disk git facts (nothing extra is stored), and a repository without worktrees stays a single native-looking row. The card's **Group workspaces** switch (experimental, default on) restores the native list instantly.

  ![Same-repository workspaces grouped in the sidebar](sidebar-grouping.png)

## Install

### From npm

```sh
dsh plugin --profile web add @laoyuehanni/dsh-git-worktree
```

> The package declares `dsh.bundle`, so `add` wires the plugin into the profile's layer stack automatically — no config editing needed. The compiled `lib/` ships in the npm tarball, so installs work out of the box without any build step. Requires the `web` profile (`dsh web`).

### From npm — dsh 0.1.2-alpha.x host

The `latest` line above tracks the stable host (rc series). If you run a dsh **0.1.2 alpha** host, install the dedicated compatibility build instead:

```sh
dsh plugin --profile web add @laoyuehanni/dsh-git-worktree@dsh-alpha
```

> `@dsh-alpha` is a dist-tag (not a literal version), so the registry resolves it to the latest compatibility build — currently `0.4.1-dsh-0.1.2-alpha.3`. Its peer range is pinned to `>=0.1.2-alpha.3 <0.2.0`, while the stable line stays on the rc peers: the two channels never get mixed by a plain `update`, and `dsh plugin update` keeps pulling from the matching channel only. Upgrading your host back to the stable line? Remove this package first, then install the default one from the section above.

### From a local directory (development)

```sh
dsh plugin --profile web add link:D:/Code/dsh-worktree
```

`link:` installs a symlink: rebuild the plugin and restart `dsh web` to apply changes.

## Update

```sh
dsh plugin --profile web update @laoyuehanni/dsh-git-worktree
```

## Remove

```sh
dsh plugin --profile web remove @laoyuehanni/dsh-git-worktree
```

The plugin is removed from the profile and stops loading. Worktree folders under `~/.dsh/gitworktree/` are kept; the migrated legacy settings file (`settings.json.migrated`) can be deleted manually if unwanted — the plugin's own settings live in the dsh settings document.

## Development

Build the plugin once:

```sh
npm install
npm run build && npm run build:client
npm test                # vitest
node scripts/smoke.mjs  # real-git smoke over the built lib
```

> **No `prepare` script — by design.** The compiled `lib/` output is committed to the repo and ships in the npm tarball. pnpm ≥ 10 refuses to run dependency build scripts unless they are allowlisted, so a `prepare` script would surface as a skipped or failed install step for pnpm users. Shipping prebuilt output instead keeps `dsh plugin add @laoyuehanni/dsh-git-worktree` working out of the box. **After changing anything under `src/`, always rebuild and commit the updated `lib/`** (and release a new version), or installs will get stale output:

```sh
npm run build && npm run build:client
git add lib/
```

Temporary mount — effective for this launch only, no profile changes. Create a `cordis.yml` next to the repo pointing at the built host half (Windows needs the `file:///` form):

```yml
- insert:
    - id: git-worktree
      name: 'file:///D:/Code/dsh-worktree/lib/index.js'
```

```sh
dsh web --patch <plugin-dir>/cordis.yml
```

This mode only mounts the host half (the three `/plugin/git-worktree/*` routes keep working); the chip needs the client bundle resolved by package name, so for UI development use the `link:` install above instead: run `npm run build && npm run build:client` (or `npx tsdown --watch` in the plugin directory), restart `dsh web`, and the browser plugin hot-reloads automatically.
