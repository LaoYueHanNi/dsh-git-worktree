# dsh-git-worktree

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

- **IDEA-style branch picker**: the branch menu treats `/` as a folder hierarchy — collapsible folders, last-segment labels, the checked-out branch's chain opens by default and is centered on open. Single click selects a row; double-click or Enter opens the right-side confirm flyout. The left tool strip offers **locate current branch** and **expand/collapse all**; the bottom search keeps the matching branches' ancestor folders and highlights the hit substring. Clipped labels expose the full name on hover.
- **Branch switching**: pick a branch from the chip's menu and confirm — an in-place `git switch`. Inside a linked worktree it switches within that worktree only.
- **Worktree isolation**: on a blank session, checking the **Worktree** toggle pops the cutout confirm right above the chip — confirming it cuts a NEW branch (`<current>-wt`, `-wt2`, … past taken names) out of the current checkout into a fresh isolated worktree; the chip's branch picker stays available for picking another branch, which turns the pick into `git worktree add` under `~/.dsh/gitworktree/<repo>-<branch>/`. Either way the folder registers as a real workspace with a fresh blank session. Same-branch re-picks reuse the existing worktree; stale registrations recover via `git worktree prune`. Dismissing the confirm and sending the message anyway knowingly stays in the current directory.
- **Storage root configurable**: the **Git Worktree** card under **Settings → Plugins** — a native folder picker or a typed absolute path, effective on save (new worktrees land in the new location; existing ones stay put and remain listable/reusable by git). Empty selects the default `$DSH_HOME/gitworktree` (`~/.dsh/gitworktree`). The value lives in the shared dsh settings document; a legacy `~/.dsh/git-worktree/settings.json` value migrates into it automatically on upgrade (the old file is renamed `.migrated` and kept).

## Install

### From npm

```sh
dsh plugin --profile web add @laoyuehanni/dsh-git-worktree
```

> The package declares `dsh.bundle`, so `add` wires the plugin into the profile's layer stack automatically — no config editing needed. The compiled `lib/` ships in the npm tarball, so installs work out of the box without any build step. Requires the `web` profile (`dsh web`).

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
npm test                # vitest (60 tests)
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
