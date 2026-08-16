# dsh-git-worktree

![dsh-git-worktree in the Web UI](gitworktree.png)

[简体中文](./README.zh.md) | English

A dsh plugin for simple branch & worktree management in the Web UI. The composer tool row shows the current branch: pick another to switch in place, or flip the **Worktree** toggle to get an isolated worktree as a real workspace — as shown in the screenshot above.

[dsh]: https://github.com/cordiverse/dsh

Repo: <https://github.com/LaoYueHanNi/dsh-git-worktree>

## Features

- **Branch switching**: pick a branch from the chip's menu and confirm — an in-place `git switch`. Inside a linked worktree it switches within that worktree only.
- **Worktree isolation**: on a blank session, the **Worktree** toggle turns the pick into `git worktree add` under `~/.dsh/gitworktree/<repo>-<branch>/`, registered as a real workspace with a fresh blank session. Same branch re-picks reuse the existing worktree; stale registrations recover via `git worktree prune`.
- **Storage root configurable**: **Settings → Git Worktree** — native folder picker, saves automatically.

## Install

### From GitHub (recommended)

```sh
dsh plugin --profile web add github:LaoYueHanNi/dsh-git-worktree
```

> The package declares `dsh.bundle`, so `add` wires the plugin into the profile's layer stack automatically — no config editing needed. The built `lib/` ships in the repo (there is no `prepare` script), so git installs work out of the box without any build allowlist. Requires the `web` profile (`dsh web`).

### From a local directory (development)

```sh
dsh plugin --profile web add link:D:/Code/dsh-worktree
```

`link:` installs a symlink: rebuild the plugin and restart `dsh web` to apply changes.

## Update

```sh
dsh plugin --profile web update dsh-git-worktree
```

## Remove

```sh
dsh plugin --profile web remove dsh-git-worktree
```

The plugin is removed from the profile and stops loading. Worktree folders under `~/.dsh/gitworktree/` and the settings file are kept — delete them manually if you no longer need them.

## Development

Build the plugin once:

```sh
npm install
npm run build && npm run build:client
npm test                # vitest (41 tests)
node scripts/smoke.mjs  # real-git smoke over the built lib
```

> **No `prepare` script — by design.** The compiled `lib/` output is committed to the repo. pnpm ≥ 10 refuses to run build scripts of git-hosted dependencies unless they are allowlisted (`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`), so a `prepare` script would break the zero-config `github:` install for every user. Shipping prebuilt output instead keeps `dsh plugin add github:LaoYueHanNi/dsh-git-worktree` working out of the box. **After changing anything under `src/`, always rebuild and commit the updated `lib/`**, or installs will get stale output:

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

This mode only mounts the host half (the four `/plugin/git-worktree/*` routes keep working); the chip needs the client bundle resolved by package name, so for UI development use the `link:` install above instead: run `npm run build && npm run build:client` (or `npx tsdown --watch` in the plugin directory), restart `dsh web`, and the browser plugin hot-reloads automatically.
