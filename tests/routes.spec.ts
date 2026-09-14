import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Exec, ExecResult } from '../src/git.ts'
import {
  handleCreateBranch, handleCreateWorktree, handleDeleteBranch, handleEnsureDirectory, handleFetch, handleGroupWorktrees, handleInspectWorktree, handlePathExists, handlePurgeDirectory, handleRemoveWorktree, handleRenameBranch, handleStatus, handleSwitch, handleUpdate, handleWorktreesAll,
  type RouteDeps,
} from '../src/routes.ts'
import { stat } from 'node:fs/promises'
import { resolveRootDir } from '../src/settings.ts'

/** Platform-correct expectation for a scripted POSIX-shaped path. */
const p = (value: string): string => normalize(value)

/** The default storage root below a fake home (platform-correct separators). */
const DEFAULT_ROOT = join('/home/u', '.dsh', 'gitworktree')

/** The DSH_HOME-based storage root (platform-correct separators). */
const ENV_ROOT = normalize('/env-home/gitworktree')

/** Best-effort cleanup list (Windows file locks must not fail the suite). */
const cleanup: string[] = []

afterEach(async () => {
  while (cleanup.length > 0) {
    const dir = cleanup.pop()
    if (dir === undefined) continue
    await rm(dir, { recursive: true, force: true }).catch(() => { /* best-effort */ })
  }
})

/** Scripted executor answering each call by first-argument key match. */
function scripted(table: Record<string, Partial<ExecResult>>): Exec {
  return async (_file, args) => {
    const key = args.join(' ')
    const entry = Object.entries(table).find(([prefix]) => key === prefix || key.startsWith(prefix))
    if (entry === undefined) throw new Error(`unexpected git call: git ${key}`)
    return { code: 0, stdout: '', stderr: '', ...entry[1] }
  }
}

/** Repo facts as the git layer reports them for /repo. */
const REPO_CALLS = {
  'rev-parse --show-toplevel': { stdout: '/repo\n' },
  'rev-parse --git-common-dir': { stdout: '/repo/.git\n' },
  'branch --show-current': { stdout: 'main\n' },
  'for-each-ref refs/heads': { stdout: 'main\nfeat/x\n' },
  'for-each-ref refs/remotes': { stdout: 'origin/HEAD\norigin/main\norigin/dev\n' },
  'worktree list --porcelain': {
    stdout: 'worktree /repo\nHEAD 1\nbranch refs/heads/main\n\nworktree /root/repo/feat-x\nHEAD 2\nbranch refs/heads/feat/x\n',
  },
} satisfies Record<string, Partial<ExecResult>>

/** The same repository, but asked about from INSIDE the linked worktree: the
 * queried toplevel is the linked folder while the shared `.git` still lives
 * in the main checkout. */
const LINKED_CALLS = {
  ...REPO_CALLS,
  'rev-parse --show-toplevel': { stdout: '/root/repo/feat-x\n' },
  'branch --show-current': { stdout: 'feat/x\n' },
} satisfies Record<string, Partial<ExecResult>>

function deps(over: Partial<RouteDeps> = {}): RouteDeps {
  return {
    exec: scripted(REPO_CALLS),
    sectionRootDir: () => undefined,
    sectionFetchBeforeCreate: () => undefined,
    home: () => '/home/u',
    envHome: () => undefined,
    dirExists: () => true,
    ...over,
  }
}

describe('handleStatus', () => {
  it('rejects a missing or relative path', async () => {
    expect((await handleStatus(deps(), undefined)).status).toBe(400)
    expect((await handleStatus(deps(), 'repo/sub')).status).toBe(400)
  })

  it('answers repo:false outside a repository', async () => {
    const exec = scripted({ 'rev-parse --show-toplevel': { code: 128, stderr: 'fatal: not a git repository' } })
    const outcome = await handleStatus(deps({ exec }), '/plain')
    expect(outcome).toEqual({ status: 200, body: { repo: false } })
  })

  it('answers repo facts with the default rootDir', async () => {
    const outcome = await handleStatus(deps(), '/repo')
    expect(outcome.status).toBe(200)
    if (!('repo' in outcome.body) || !outcome.body.repo) throw new Error('expected repo facts')
    expect(outcome.body.repoName).toBe('repo')
    expect(outcome.body.rootDir).toBe(DEFAULT_ROOT)
    expect(outcome.body.branches.map(b => b.name)).toEqual(['main', 'feat/x', 'origin/dev'])
    // The session-scope trigger the chip reads: /repo IS the main checkout.
    expect(outcome.body.main).toBe(true)
  })

  it('reports main:false when the queried directory is a linked worktree', async () => {
    const outcome = await handleStatus(deps({ exec: scripted(LINKED_CALLS) }), '/root/repo/feat-x')
    if (!('repo' in outcome.body) || !outcome.body.repo) throw new Error('expected repo facts')
    // Same repository (repoRoot/repoName), different answer: the branch list
    // and worktree list still come from the shared checkout, but the queried
    // directory is NOT it.
    // repoRoot is dirname(resolve(...)) — an absolute platform path, not the
    // normalize()-only shape `p` produces for a bare POSIX literal.
    expect(outcome.body.repoRoot).toBe(resolve('/repo'))
    expect(outcome.body.main).toBe(false)
    expect(outcome.body.currentBranch).toBe('feat/x')
  })

  it('answers with a configured absolute rootDir', async () => {
    const outcome = await handleStatus(deps({ sectionRootDir: () => 'D:\\wt-root' }), '/repo')
    if (!('repo' in outcome.body) || !outcome.body.repo) throw new Error('expected repo facts')
    expect(outcome.body.rootDir).toBe('D:\\wt-root')
  })

  it('answers with the DSH_HOME-based root when the section is unset', async () => {
    const outcome = await handleStatus(deps({ envHome: () => '/env-home' }), '/repo')
    if (!('repo' in outcome.body) || !outcome.body.repo) throw new Error('expected repo facts')
    expect(outcome.body.rootDir).toBe(ENV_ROOT)
  })
})

describe('handleCreateWorktree', () => {
  it('rejects bodies with unknown or mistyped keys', async () => {
    expect((await handleCreateWorktree(deps(), { repoPath: '/repo', branch: 'main', extra: 1 })).status).toBe(400)
    expect((await handleCreateWorktree(deps(), { repoPath: '/repo' })).status).toBe(400)
    expect((await handleCreateWorktree(deps(), null)).status).toBe(400)
  })

  it('rejects a non-absolute repoPath or empty branch', async () => {
    expect((await handleCreateWorktree(deps(), { repoPath: 'repo', branch: 'main' })).status).toBe(400)
    expect((await handleCreateWorktree(deps(), { repoPath: '/repo', branch: '  ' })).status).toBe(400)
  })

  it('rejects a configured relative rootDir before touching disk', async () => {
    const outcome = await handleCreateWorktree(
      deps({ sectionRootDir: () => 'wt/root' }),
      { repoPath: '/repo', branch: 'dev' },
    )
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('absolute')
  })

  it('creates the storage directory and reports the sanitized target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-gwt-'))
    cleanup.push(root)
    const calls = { ...REPO_CALLS } as Record<string, Partial<ExecResult>>
    calls['worktree add'] = {}
    const outcome = await handleCreateWorktree(
      deps({ exec: scripted(calls), sectionRootDir: () => root }),
      { repoPath: '/repo', branch: 'origin/dev' },
    )
    expect(outcome).toEqual({ status: 200, body: { path: join(root, 'repo-origin-dev'), created: true } })
  })

  it('reports reuse when the worktree already exists', async () => {
    const outcome = await handleCreateWorktree(deps(), { repoPath: '/repo', branch: 'feat/x' })
    expect(outcome).toEqual({ status: 200, body: { path: p('/root/repo/feat-x'), created: false } })
  })

  it('maps a git failure to an error envelope', async () => {
    const calls = { ...REPO_CALLS } as Record<string, Partial<ExecResult>>
    calls['worktree add'] = { code: 128, stderr: 'fatal: invalid reference' }
    // The branch must exist locally AND hold no worktree for the failure to
    // land IN `worktree add` (occupied branches take the reuse path, an
    // unknown name is refused earlier inside resolveBranch).
    calls['worktree list --porcelain'] = { stdout: 'worktree /repo\nHEAD 1\nbranch refs/heads/main\n' }
    const outcome = await handleCreateWorktree(deps({ exec: scripted(calls) }), { repoPath: '/repo', branch: 'feat/x' })
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('fatal')
  })

  it('maps an unresolvable branch name to a 400 envelope', async () => {
    // 'dev' exists in no namespace here: resolveBranch refuses it before any
    // `worktree add`, and the synthetic `branch "dev" not found` stderr (the
    // `branch "` shape gitFailure matches) is caller misuse (400).
    const outcome = await handleCreateWorktree(deps(), { repoPath: '/repo', branch: 'dev' })
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('not found')
  })

  it('cuts a new branch out of the current one into the sanitized target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-gwt-'))
    cleanup.push(root)
    const calls = { ...REPO_CALLS } as Record<string, Partial<ExecResult>>
    calls['worktree add'] = {}
    const outcome = await handleCreateWorktree(
      deps({ exec: scripted(calls), sectionRootDir: () => root, dirExists: () => false }),
      { repoPath: '/repo', branch: 'main', cutout: true },
    )
    expect(outcome).toEqual({ status: 200, body: { path: join(root, 'repo-main-wt'), created: true } })
  })

  it('suffixes the cutout branch past an existing -wt name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-gwt-'))
    cleanup.push(root)
    const calls = { ...REPO_CALLS } as Record<string, Partial<ExecResult>>
    calls['for-each-ref refs/heads'] = { stdout: 'main\nmain-wt\nfeat/x\n' }
    calls['worktree add'] = {}
    const outcome = await handleCreateWorktree(
      deps({ exec: scripted(calls), sectionRootDir: () => root, dirExists: () => false }),
      { repoPath: '/repo', branch: 'main', cutout: true },
    )
    expect(outcome).toEqual({ status: 200, body: { path: join(root, 'repo-main-wt2'), created: true } })
  })

  it('skips a cutout name whose storage folder lingers on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-gwt-'))
    cleanup.push(root)
    const calls = { ...REPO_CALLS } as Record<string, Partial<ExecResult>>
    calls['worktree add'] = {}
    const stale = join(root, 'repo-main-wt')
    const outcome = await handleCreateWorktree(
      deps({
        exec: scripted(calls),
        sectionRootDir: () => root,
        // `main-wt` is branch-free, but its folder survived a manual branch
        // deletion — the cutout must move past it instead of failing add.
        dirExists: path => path === stale,
      }),
      { repoPath: '/repo', branch: 'main', cutout: true },
    )
    expect(outcome).toEqual({ status: 200, body: { path: join(root, 'repo-main-wt2'), created: true } })
  })

  it('cuts out with an explicit custom branch name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-gwt-'))
    cleanup.push(root)
    const calls = { ...REPO_CALLS } as Record<string, Partial<ExecResult>>
    calls['worktree add'] = {}
    const outcome = await handleCreateWorktree(
      deps({ exec: scripted(calls), sectionRootDir: () => root }),
      { repoPath: '/repo', branch: 'main', cutout: true, name: 'feat-x' },
    )
    expect(outcome).toEqual({ status: 200, body: { path: join(root, 'repo-feat-x'), created: true } })
  })

  it('rejects a cutout name riding the command line as a flag', async () => {
    const outcome = await handleCreateWorktree(
      deps(),
      { repoPath: '/repo', branch: 'main', cutout: true, name: '-feat' },
    )
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('-')
  })

  it('rejects a non-string cutout name', async () => {
    const outcome = await handleCreateWorktree(
      deps(),
      { repoPath: '/repo', branch: 'main', cutout: true, name: 7 },
    )
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('string')
  })

  it('maps an explicit cutout name colliding with an existing branch to a 400 envelope', async () => {
    const calls = {
      ...REPO_CALLS,
      'worktree add': { code: 128, stderr: "fatal: a branch named 'feat-x' already exists\n" },
    } as Record<string, Partial<ExecResult>>
    const outcome = await handleCreateWorktree(
      deps({ exec: scripted(calls) }),
      { repoPath: '/repo', branch: 'main', cutout: true, name: 'feat-x' },
    )
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('already exists')
  })

  it('rejects a non-boolean cutout key', async () => {
    const outcome = await handleCreateWorktree(deps(), { repoPath: '/repo', branch: 'main', cutout: 1 })
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('boolean')
  })
})

describe('handleSwitch', () => {
  it('switches and reports the resolved local branch', async () => {
    const calls = { ...REPO_CALLS, 'switch dev': {} } as Record<string, Partial<ExecResult>>
    const outcome = await handleSwitch(deps({ exec: scripted(calls) }), { repoPath: '/repo', branch: 'origin/dev' })
    expect(outcome).toEqual({ status: 200, body: { branch: 'dev' } })
  })

  it('rejects unknown body keys', async () => {
    expect((await handleSwitch(deps(), { repoPath: '/repo', branch: 'main', why: true })).status).toBe(400)
  })
})

describe('handleCreateBranch', () => {
  it('creates from the current checkout and reports the name', async () => {
    const calls = { ...REPO_CALLS, 'switch -c feat/x': {} } as Record<string, Partial<ExecResult>>
    const outcome = await handleCreateBranch(deps({ exec: scripted(calls) }), { repoPath: '/repo', name: 'feat/x' })
    expect(outcome).toEqual({ status: 200, body: { branch: 'feat/x' } })
  })

  it('creates at an explicit start point without touching the checkout', async () => {
    const calls = { ...REPO_CALLS, 'branch dev origin/main': {} } as Record<string, Partial<ExecResult>>
    const outcome = await handleCreateBranch(deps({ exec: scripted(calls) }), { repoPath: '/repo', name: 'dev', from: 'origin/main' })
    expect(outcome).toEqual({ status: 200, body: { branch: 'dev' } })
  })

  it('creates at a start point and checks it out when checkout is set', async () => {
    const calls = { ...REPO_CALLS, 'switch -c dev origin/main': {} } as Record<string, Partial<ExecResult>>
    const outcome = await handleCreateBranch(deps({ exec: scripted(calls) }), { repoPath: '/repo', name: 'dev', from: 'origin/main', checkout: true })
    expect(outcome).toEqual({ status: 200, body: { branch: 'dev' } })
  })

  it('rejects unknown body keys', async () => {
    expect((await handleCreateBranch(deps(), { repoPath: '/repo', name: 'dev', bases: 'main' })).status).toBe(400)
    expect((await handleCreateBranch(deps(), null)).status).toBe(400)
  })

  it('rejects a leading-dash or empty start point before it can ride the command line', async () => {
    expect((await handleCreateBranch(deps(), { repoPath: '/repo', name: 'dev', from: '-main' })).status).toBe(400)
    expect((await handleCreateBranch(deps(), { repoPath: '/repo', name: 'dev', from: '  ' })).status).toBe(400)
  })

  it('rejects a non-absolute repoPath or empty name', async () => {
    expect((await handleCreateBranch(deps(), { repoPath: 'repo', name: 'dev' })).status).toBe(400)
    expect((await handleCreateBranch(deps(), { repoPath: '/repo', name: '  ' })).status).toBe(400)
  })

  it('rejects a leading dash before it can ride the command line as a flag', async () => {
    const outcome = await handleCreateBranch(deps(), { repoPath: '/repo', name: '-feat' })
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('-')
  })

  it('rejects a directory outside any repository', async () => {
    const exec = scripted({ 'rev-parse --show-toplevel': { code: 128, stderr: 'fatal: not a git repository' } })
    const outcome = await handleCreateBranch(deps({ exec }), { repoPath: '/plain', name: 'dev' })
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('not inside a git repository')
  })

  it('maps a git refusal of the name to a 400 envelope', async () => {
    const calls = {
      ...REPO_CALLS,
      'switch -c bad..name': { code: 128, stderr: "fatal: 'bad..name' is not a valid branch name\n" },
    } as Record<string, Partial<ExecResult>>
    const outcome = await handleCreateBranch(deps({ exec: scripted(calls) }), { repoPath: '/repo', name: 'bad..name' })
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('not a valid branch name')
  })

  it('maps a duplicate branch name to a 400 envelope', async () => {
    const calls = {
      ...REPO_CALLS,
      'switch -c main': { code: 128, stderr: "fatal: a branch named 'main' already exists\n" },
    } as Record<string, Partial<ExecResult>>
    const outcome = await handleCreateBranch(deps({ exec: scripted(calls) }), { repoPath: '/repo', name: 'main' })
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('already exists')
  })
})

describe('handleRenameBranch', () => {
  it('renames at the repository root and reports the new name', async () => {
    const calls = { ...REPO_CALLS, 'branch -m feat/x feat/y': {} } as Record<string, Partial<ExecResult>>
    const outcome = await handleRenameBranch(deps({ exec: scripted(calls) }), { repoPath: '/repo', name: 'feat/x', newName: 'feat/y' })
    expect(outcome).toEqual({ status: 200, body: { branch: 'feat/y' } })
  })

  it('rejects unknown body keys, a non-absolute repoPath, and an empty name', async () => {
    expect((await handleRenameBranch(deps(), { repoPath: '/repo', name: 'feat/x', newName: 'feat/y', force: true })).status).toBe(400)
    expect((await handleRenameBranch(deps(), { repoPath: 'repo', name: 'feat/x', newName: 'feat/y' })).status).toBe(400)
    expect((await handleRenameBranch(deps(), { repoPath: '/repo', name: 'feat/x', newName: '  ' })).status).toBe(400)
  })

  it('rejects a leading dash in the new name before it can ride the command line', async () => {
    const outcome = await handleRenameBranch(deps(), { repoPath: '/repo', name: 'feat/x', newName: '-feat' })
    expect(outcome.status).toBe(400)
  })

  it('maps a duplicate target to a 400 envelope', async () => {
    const calls = {
      ...REPO_CALLS,
      'branch -m feat/x main': { code: 128, stderr: "fatal: a branch named 'main' already exists\n" },
    } as Record<string, Partial<ExecResult>>
    const outcome = await handleRenameBranch(deps({ exec: scripted(calls) }), { repoPath: '/repo', name: 'feat/x', newName: 'main' })
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('already exists')
  })
})

describe('handleDeleteBranch', () => {
  it('deletes with the safe -d form and reports the name', async () => {
    const calls = { ...REPO_CALLS, 'branch -d feat/x': {} } as Record<string, Partial<ExecResult>>
    const outcome = await handleDeleteBranch(deps({ exec: scripted(calls) }), { repoPath: '/repo', name: 'feat/x' })
    expect(outcome).toEqual({ status: 200, body: { branch: 'feat/x' } })
  })

  it('rejects unknown body keys, a non-absolute repoPath, and an empty name', async () => {
    expect((await handleDeleteBranch(deps(), { repoPath: '/repo', name: 'feat/x', force: true })).status).toBe(400)
    expect((await handleDeleteBranch(deps(), { repoPath: 'repo', name: 'feat/x' })).status).toBe(400)
    expect((await handleDeleteBranch(deps(), { repoPath: '/repo', name: '  ' })).status).toBe(400)
  })

  it('rejects a leading dash before it can ride the command line as a flag', async () => {
    const outcome = await handleDeleteBranch(deps(), { repoPath: '/repo', name: '-feat' })
    expect(outcome.status).toBe(400)
  })

  it('maps deletion refusals (unmerged, checked out) to a 400 envelope', async () => {
    const unmerged = {
      ...REPO_CALLS,
      'branch -d feat/x': { code: 1, stderr: "error: the branch 'feat/x' is not fully merged.\n" },
    } as Record<string, Partial<ExecResult>>
    const occupied = {
      ...REPO_CALLS,
      'branch -d main': { code: 1, stderr: "error: Cannot delete branch 'main' checked out at '/repo'\n" },
    } as Record<string, Partial<ExecResult>>
    const first = await handleDeleteBranch(deps({ exec: scripted(unmerged) }), { repoPath: '/repo', name: 'feat/x' })
    const second = await handleDeleteBranch(deps({ exec: scripted(occupied) }), { repoPath: '/repo', name: 'main' })
    expect(first.status).toBe(400)
    expect(second.status).toBe(400)
    if (!('error' in first.body) || !('error' in second.body)) throw new Error('expected error bodies')
    expect(first.body.error).toContain('not fully merged')
    expect(second.body.error).toContain('Cannot delete branch')
  })
})

describe('handleFetch', () => {
  it('fetches every remote and reports the coverage', async () => {
    const calls = { ...REPO_CALLS, 'fetch --all --prune': {} } as Record<string, Partial<ExecResult>>
    const outcome = await handleFetch(deps({ exec: scripted(calls) }), { repoPath: '/repo' })
    expect(outcome).toEqual({ status: 200, body: { remote: 'all' } })
  })

  it('rejects unknown body keys and a non-absolute repoPath', async () => {
    expect((await handleFetch(deps(), { repoPath: '/repo', branch: 'main' })).status).toBe(400)
    expect((await handleFetch(deps(), { repoPath: 'repo' })).status).toBe(400)
  })

  it('rejects a directory outside any repository', async () => {
    const exec = scripted({ 'rev-parse --show-toplevel': { code: 128, stderr: 'fatal: not a git repository' } })
    const outcome = await handleFetch(deps({ exec }), { repoPath: '/plain' })
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('not inside a git repository')
  })

  it('maps a network failure to an error envelope', async () => {
    const calls = {
      ...REPO_CALLS,
      'fetch --all --prune': { code: 128, stderr: 'fatal: unable to access: Could not resolve host\n' },
    } as Record<string, Partial<ExecResult>>
    const outcome = await handleFetch(deps({ exec: scripted(calls) }), { repoPath: '/repo' })
    expect(outcome.status).toBe(500)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('Could not resolve host')
  })

  it('maps a vanished remote to a 500 envelope, not the 400 not-found class', async () => {
    // git's own `Repository '...' not found` stderr contains "not found"
    // but NOT the synthetic `branch "` shape: the 400 class is reserved
    // for display names the menu invented, a deleted remote is host state.
    const calls = {
      ...REPO_CALLS,
      'fetch --all --prune': { code: 128, stderr: "fatal: unable to access 'https://x/': Repository 'gone' not found\n" },
    } as Record<string, Partial<ExecResult>>
    const outcome = await handleFetch(deps({ exec: scripted(calls) }), { repoPath: '/repo' })
    expect(outcome.status).toBe(500)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain("Repository 'gone' not found")
  })
})

describe('handleUpdate', () => {
  it('fetches and fast-forwards the checked-out branch', async () => {
    const calls = {
      ...REPO_CALLS,
      'fetch --all --prune': {},
      'rev-parse HEAD': { stdout: 'aaa111\n' },
      'merge --ff-only @{u}': { stdout: 'Updating aaa111..bbb222\nFast-forward\n' },
      'branch --show-current': { stdout: 'main\n' },
    } as Record<string, Partial<ExecResult>>
    // rev-parse HEAD runs twice (before/after); the prefix matcher answers
    // both with the LAST scripted entry for the key — evolve it per call.
    let at = 0
    const evolving = scripted(calls)
    const exec: typeof evolving = async (file, args, options) => {
      if (args.join(' ') === 'rev-parse HEAD') {
        at += 1
        calls['rev-parse HEAD'] = { stdout: at === 1 ? 'aaa111\n' : 'bbb222\n' }
      }
      return evolving(file, args, options)
    }
    const outcome = await handleUpdate(deps({ exec }), { repoPath: '/repo' })
    expect(outcome).toEqual({ status: 200, body: { branch: 'main', updated: true } })
  })

  it('updates the worktree the session sits in, not the main checkout', async () => {
    const calls = {
      ...LINKED_CALLS,
      'fetch --all --prune': {},
      'rev-parse HEAD': { stdout: 'aaa111\n' },
      'merge --ff-only @{u}': { stdout: 'Already up to date.\n' },
    } as Record<string, Partial<ExecResult>>
    const base = scripted(calls)
    const seen: { args: string; cwd: string }[] = []
    const exec: Exec = async (file, args, options) => {
      seen.push({ args: args.join(' '), cwd: options.cwd })
      return base(file, args, options)
    }
    const outcome = await handleUpdate(deps({ exec }), { repoPath: '/root/repo/feat-x' })
    expect(outcome).toEqual({ status: 200, body: { branch: 'feat/x', updated: false } })
    /** Every cwd the one command ran with. */
    const cwdsOf = (args: string): string[] =>
      seen.filter(entry => entry.args === args).map(entry => entry.cwd)
    // The checkout-level commands run in the session's OWN worktree — the
    // same directory a session-level `git merge --ff-only` would run in by
    // hand. Rooting them at `repoRoot` fast-forwards the main checkout
    // instead, behind the user's back (regression: the repoRoot field stopped
    // naming the queried directory and nothing here noticed).
    expect(cwdsOf('fetch --all --prune')).toEqual([p('/root/repo/feat-x')])
    expect(cwdsOf('merge --ff-only @{u}')).toEqual([p('/root/repo/feat-x')])
    expect(cwdsOf('rev-parse HEAD')).toEqual([p('/root/repo/feat-x'), p('/root/repo/feat-x')])
    // Repository-wide reads keep the shared checkout (the branch list and the
    // worktree list belong to the repository, not to one worktree).
    expect(cwdsOf('worktree list --porcelain')).toEqual([resolve('/repo')])
  })

  it('maps a diverged branch to a 400 envelope', async () => {
    const calls = {
      ...REPO_CALLS,
      'fetch --all --prune': {},
      'rev-parse HEAD': { stdout: 'aaa111\n' },
      'merge --ff-only @{u}': { code: 128, stderr: 'fatal: Not possible to fast-forward, aborting.\n' },
    } as Record<string, Partial<ExecResult>>
    const outcome = await handleUpdate(deps({ exec: scripted(calls) }), { repoPath: '/repo' })
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('Not possible to fast-forward')
  })

  it('rejects unknown body keys and a non-absolute repoPath', async () => {
    expect((await handleUpdate(deps(), { repoPath: '/repo', branch: 'main' })).status).toBe(400)
    expect((await handleUpdate(deps(), { repoPath: 'repo' })).status).toBe(400)
  })
})

describe('resolveRootDir', () => {
  it('defaults to ~/.dsh/gitworktree without a section or env home', () => {
    expect(resolveRootDir(undefined, '/home/u', undefined)).toBe(DEFAULT_ROOT)
    expect(resolveRootDir('', '/home/u', undefined)).toBe(DEFAULT_ROOT)
    expect(resolveRootDir('   ', '/home/u', undefined)).toBe(DEFAULT_ROOT)
  })

  it('prefers $DSH_HOME over the user home when the section is unset', () => {
    expect(resolveRootDir(undefined, '/home/u', '/env-home')).toBe(ENV_ROOT)
    expect(resolveRootDir('', '/home/u', '  ')).toBe(DEFAULT_ROOT)
  })

  it('uses a configured root verbatim', () => {
    expect(resolveRootDir(' D:\\wt ', '/home/u', '/env-home')).toBe('D:\\wt')
  })
})

describe('handleGroupWorktrees', () => {
  /** Platform-real directory shapes — Windows runs get drive-qualified paths. */
  const REPO = resolve('/repo')
  const WT = resolve('/wt/feat-x')

  /**
   * Executor keyed by cwd then argument prefix: /group probes MANY
   * directories with the SAME commands, so the argument-keyed scripted()
   * above cannot tell them apart.
   */
  function cwdScripted(table: Record<string, Record<string, Partial<ExecResult>>>): Exec {
    return async (_file, args, options) => {
      const perDir = table[options.cwd]
      if (perDir === undefined) throw new Error(`unexpected cwd: ${options.cwd}`)
      const key = args.join(' ')
      const entry = Object.entries(perDir).find(([prefix]) => key === prefix || key.startsWith(prefix))
      if (entry === undefined) throw new Error(`unexpected git call in ${options.cwd}: git ${key}`)
      return { code: 0, stdout: '', stderr: '', ...entry[1] }
    }
  }

  /** Main checkout answers: own toplevel, shared .git, branch main. */
  const MAIN_CALLS = {
    'rev-parse --show-toplevel --git-common-dir --abbrev-ref HEAD': { stdout: `${REPO.replace(/\\/g, '/')}\n.git\nmain\n` },
  } satisfies Record<string, Partial<ExecResult>>

  /** Linked worktree answers: its own toplevel, common dir back to REPO. */
  const LINKED_CALLS = {
    'rev-parse --show-toplevel --git-common-dir --abbrev-ref HEAD': { stdout: `${WT.replace(/\\/g, '/')}\n../../repo/.git\nfeat-x\n` },
  } satisfies Record<string, Partial<ExecResult>>

  it('rejects a malformed body, relative paths, and unknown keys', async () => {
    expect((await handleGroupWorktrees(deps(), undefined)).status).toBe(400)
    expect((await handleGroupWorktrees(deps(), { paths: 'x' })).status).toBe(400)
    expect((await handleGroupWorktrees(deps(), { paths: ['repo/sub'] })).status).toBe(400)
    expect((await handleGroupWorktrees(deps(), { paths: [REPO], extra: 1 })).status).toBe(400)
  })

  it('caps distinct paths at 256', async () => {
    const paths = Array.from({ length: 257 }, (_v, i) => resolve(`/p/${String(i)}`))
    expect((await handleGroupWorktrees(deps(), { paths })).status).toBe(400)
  })

  it('dedupes and answers per-path facts with one shared grouping key', async () => {
    const exec = cwdScripted({ [REPO]: MAIN_CALLS, [WT]: LINKED_CALLS })
    const outcome = await handleGroupWorktrees(deps({ exec }), { paths: [REPO, WT, REPO] })
    expect(outcome.status).toBe(200)
    if (!('facts' in outcome.body)) throw new Error('expected facts body')
    const facts = outcome.body.facts
    // Keys echo the requested path verbatim (deduped); VALUES share one key.
    expect(Object.keys(facts).sort()).toEqual([REPO, WT].sort())
    expect(facts[REPO]).toEqual({ repoRoot: REPO, repoName: 'repo', branch: 'main', main: true })
    expect(facts[WT]).toEqual({ repoRoot: REPO, repoName: 'repo', branch: 'feat-x', main: false })
  })

  it('answers null for non-repositories and stays 200 when git fails everywhere', async () => {
    const PLAIN = resolve('/plain')
    const exec = cwdScripted({
      [PLAIN]: {
        'rev-parse --show-toplevel --git-common-dir --abbrev-ref HEAD': { code: 128, stderr: 'fatal: not a git repository\n' },
      },
      [REPO]: MAIN_CALLS,
    })
    const outcome = await handleGroupWorktrees(deps({ exec }), { paths: [PLAIN, REPO] })
    expect(outcome.status).toBe(200)
    if (!('facts' in outcome.body)) throw new Error('expected facts body')
    expect(outcome.body.facts[PLAIN]).toBeNull()
    expect(outcome.body.facts[REPO]).not.toBeNull()
  })
})

describe('handleInspectWorktree', () => {
  it('rejects a malformed body, unknown keys, and a relative path', async () => {
    expect((await handleInspectWorktree(deps(), undefined)).status).toBe(400)
    expect((await handleInspectWorktree(deps(), { path: '/repo', extra: 1 })).status).toBe(400)
    expect((await handleInspectWorktree(deps(), { path: 'repo/sub' })).status).toBe(400)
    expect((await handleInspectWorktree(deps(), { path: '  ' })).status).toBe(400)
  })

  it('answers the dirty and ahead counts inside a repository', async () => {
    const exec = scripted({
      ...REPO_CALLS,
      'status --porcelain': { stdout: ' M a.ts\n?? b.ts\n' },
      'rev-list --count': { stdout: '4\n' },
    })
    const outcome = await handleInspectWorktree(deps({ exec }), { path: '/repo' })
    expect(outcome).toEqual({ status: 200, body: { dirty: 2, ahead: 4 } })
  })

  it('omits ahead when the branch has no upstream', async () => {
    const exec = scripted({
      ...REPO_CALLS,
      'status --porcelain': { stdout: '' },
      'rev-list --count': { code: 128, stderr: "fatal: no upstream configured for branch 'main'\n" },
    })
    const outcome = await handleInspectWorktree(deps({ exec }), { path: '/repo' })
    expect(outcome).toEqual({ status: 200, body: { dirty: 0 } })
  })

  it('answers 400 outside a repository', async () => {
    const exec = scripted({ 'rev-parse --show-toplevel': { code: 128, stderr: 'fatal: not a git repository\n' } })
    expect((await handleInspectWorktree(deps({ exec }), { path: '/plain' })).status).toBe(400)
  })
})

describe('handleRemoveWorktree', () => {
  /** The linked worktree of REPO_CALLS' porcelain, platform-normalized. */
  const LINKED = p('/root/repo/feat-x')

  it('rejects a malformed body, unknown keys, a mistyped force, and a relative path', async () => {
    expect((await handleRemoveWorktree(deps(), undefined)).status).toBe(400)
    expect((await handleRemoveWorktree(deps(), { path: '/repo', extra: 1 })).status).toBe(400)
    expect((await handleRemoveWorktree(deps(), { path: '/repo', force: 'yes' })).status).toBe(400)
    expect((await handleRemoveWorktree(deps(), { path: 'repo' })).status).toBe(400)
  })

  it('removes a live linked worktree with or without force', async () => {
    const plain = scripted({ ...REPO_CALLS, 'worktree remove': {} })
    const outcome = await handleRemoveWorktree(deps({ exec: plain }), { path: LINKED })
    expect(outcome).toEqual({ status: 200, body: { path: LINKED, pruned: false } })

    const forced = scripted({ ...REPO_CALLS, 'worktree remove': {} })
    expect((await handleRemoveWorktree(deps({ exec: forced }), { path: LINKED, force: true })).status).toBe(200)
  })

  it('prunes a stale registration and reports pruned', async () => {
    const exec = scripted({ ...REPO_CALLS, 'worktree prune': {} })
    const outcome = await handleRemoveWorktree(deps({ exec, dirExists: () => false }), { path: LINKED })
    expect(outcome).toEqual({ status: 200, body: { path: LINKED, pruned: true } })
  })

  it('refuses the main worktree with 400, not a spawned git failure', async () => {
    const outcome = await handleRemoveWorktree(deps(), { path: '/repo' })
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('main worktree')
  })

  it('refuses a path the repository never registered with 400', async () => {
    const outcome = await handleRemoveWorktree(deps(), { path: '/repo/sub' })
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('not a registered worktree')
  })

  it('answers 400 outside a repository', async () => {
    const exec = scripted({ 'rev-parse --show-toplevel': { code: 128, stderr: 'fatal: not a git repository\n' } })
    expect((await handleRemoveWorktree(deps({ exec }), { path: '/plain' })).status).toBe(400)
  })

  it('surfaces a refused removal as the error envelope', async () => {
    const exec = scripted({
      ...REPO_CALLS,
      'worktree remove': { code: 128, stderr: 'fatal: unable to remove: file(s) locked\n' },
    })
    const outcome = await handleRemoveWorktree(deps({ exec }), { path: LINKED })
    expect(outcome.status).toBe(500)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('locked')
  })
})

describe('handlePathExists', () => {
  it('rejects a malformed body, unknown keys, and non-absolute paths', async () => {
    expect((await handlePathExists(deps(), undefined)).status).toBe(400)
    expect((await handlePathExists(deps(), { paths: '/repo' })).status).toBe(400)
    expect((await handlePathExists(deps(), { paths: ['/repo'], extra: 1 })).status).toBe(400)
    expect((await handlePathExists(deps(), { paths: ['repo'] })).status).toBe(400)
  })

  it('probes each distinct path and answers true only for real directories', async () => {
    const statDirectory = vi.fn(async (path: string) => path === p('/repo'))
    const outcome = await handlePathExists(deps({ statDirectory }), { paths: [p('/repo'), p('/gone'), p('/repo')] })
    expect(outcome).toEqual({ status: 200, body: { exists: { [p('/repo')]: true, [p('/gone')]: false } } })
    // Deduped server-side: one stat per distinct path.
    expect(statDirectory).toHaveBeenCalledTimes(2)
  })

  it('reads a throwing probe as not-a-directory instead of failing the batch', async () => {
    const statDirectory = vi.fn(async (path: string) => {
      if (path === p('/boom')) throw new Error('EACCES')
      return true
    })
    const outcome = await handlePathExists(deps({ statDirectory }), { paths: [p('/boom'), p('/ok')] })
    expect(outcome).toEqual({ status: 200, body: { exists: { [p('/boom')]: false, [p('/ok')]: true } } })
  })

  it('caps distinct paths at 256', async () => {
    const paths = Array.from({ length: 257 }, (_v, i) => resolve(`/p/${String(i)}`))
    expect((await handlePathExists(deps(), { paths })).status).toBe(400)
  })

  it('marks a missing path directly under the storage root as rebuildable', async () => {
    // Default root: /home/u/.dsh/gitworktree (resolveRootDir's home fallback).
    const ROOT = join('/home/u', '.dsh', 'gitworktree')
    const SLOT = join(ROOT, 'repo-feat-x')
    const statDirectory = vi.fn(async () => false)
    const outcome = await handlePathExists(deps({ statDirectory }), {
      paths: [SLOT, p('/elsewhere/gone'), join(ROOT, 'deep', 'nested')],
    })
    expect(outcome.status).toBe(200)
    if (!('rebuildable' in outcome.body) || outcome.body.rebuildable === undefined) throw new Error('expected rebuildable')
    // Keys echo the requested path verbatim; only the VALUE comparison is
    // resolved (drive letters on Windows must not fork the key space).
    expect(outcome.body.rebuildable[SLOT]).toBe(true)
    expect(outcome.body.rebuildable[p('/elsewhere/gone')]).toBe(false)
    // Deeper than one level under the root is outside the slot boundary.
    expect(outcome.body.rebuildable[join(ROOT, 'deep', 'nested')]).toBe(false)
  })

  it('omits rebuildable when every probed path exists', async () => {
    const statDirectory = vi.fn(async () => true)
    const outcome = await handlePathExists(deps({ statDirectory }), { paths: [p('/repo')] })
    expect(outcome).toEqual({ status: 200, body: { exists: { [p('/repo')]: true } } })
  })
})

describe('handleEnsureDirectory', () => {
  /** The default storage root below the fake home (platform separators). */
  const ROOT = join('/home/u', '.dsh', 'gitworktree')

  it('rejects a non-absolute path and paths outside the storage root', async () => {
    expect((await handleEnsureDirectory(deps(), { path: 'repo-x' })).status).toBe(400)
    expect((await handleEnsureDirectory(deps(), { path: p('/elsewhere/repo-x') })).status).toBe(400)
    // `..` cannot escape: resolved form decides, not spelling.
    expect((await handleEnsureDirectory(deps(), { path: join(ROOT, '..', 'escape') })).status).toBe(400)
    // Deeper than one level is refused too.
    expect((await handleEnsureDirectory(deps(), { path: join(ROOT, 'a', 'b') })).status).toBe(400)
  })

  it('creates a missing slot and reports created', async () => {
    const mkdirRecursive = vi.fn(async () => {})
    const target = join(ROOT, 'repo-feat-x')
    const outcome = await handleEnsureDirectory(deps({ mkdirRecursive, statDirectory: async () => false }), { path: target })
    expect(outcome).toEqual({ status: 200, body: { created: true } })
    expect(mkdirRecursive).toHaveBeenCalledWith(resolve(target))
  })

  it('answers created without mkdir when the slot already exists', async () => {
    const mkdirRecursive = vi.fn(async () => {})
    const outcome = await handleEnsureDirectory(deps({ mkdirRecursive, statDirectory: async () => true }), { path: join(ROOT, 'repo-feat-x') })
    expect(outcome).toEqual({ status: 200, body: { created: true } })
    expect(mkdirRecursive).not.toHaveBeenCalled()
  })
})

describe('handleCreateWorktree fetch-before-create', () => {
  /** Deps with the sync enabled; the fetch is answered separately from the
   * repo-facts script and its invocations recorded. The worktree add and
   * the storage-root mkdir are stubbed so a remote twin can be CREATED
   * (not just reused) without touching the real fs. */
  function fetchDeps(fetch: Partial<ExecResult>, recorded: string[], extraScript: Record<string, Partial<ExecResult>> = {}): RouteDeps {
    const base = scripted({ ...REPO_CALLS, ...extraScript })
    return deps({
      sectionFetchBeforeCreate: () => true,
      mkdirRecursive: async () => {},
      exec: async (file, args, options) => {
        if (args.join(' ') === 'fetch --all --prune') {
          recorded.push(options.cwd)
          return { code: 0, stdout: '', stderr: '', ...fetch }
        }
        return base(file, args, options)
      },
    })
  }

  it('is off by default: no fetch runs (the script would refuse the call)', async () => {
    const outcome = await handleCreateWorktree(deps(), { repoPath: '/repo', branch: 'feat/x' })
    expect(outcome).toEqual({ status: 200, body: { path: p('/root/repo/feat-x'), created: false } })
  })

  it('fetches ONLY for a remote-only branch, before creating its twin', async () => {
    const recorded: string[] = []
    const outcome = await handleCreateWorktree(
      fetchDeps({}, recorded, { 'worktree add': {} }),
      { repoPath: '/repo', branch: 'origin/dev' },
    )
    // probeRepo resolves the repo root (Windows gains the current drive letter).
    expect(recorded).toEqual([resolve('/repo')])
    expect(outcome.status).toBe(200)
    if (outcome.status !== 200 || !('path' in outcome.body)) throw new Error('expected a creation body')
    expect(outcome.body.created).toBe(true)
    if ('fetchWarning' in outcome.body && outcome.body.fetchWarning !== undefined) throw new Error('expected no fetchWarning')
  })

  it('skips the fetch for a LOCAL branch: its worktree never consumes remote data', async () => {
    const recorded: string[] = []
    const outcome = await handleCreateWorktree(fetchDeps({}, recorded), { repoPath: '/repo', branch: 'feat/x' })
    expect(recorded).toEqual([])
    expect(outcome).toEqual({ status: 200, body: { path: p('/root/repo/feat-x'), created: false } })
  })

  it('does not block on a failed fetch: the twin creation lands with a fetchWarning', async () => {
    const recorded: string[] = []
    const outcome = await handleCreateWorktree(
      fetchDeps({ code: 128, stderr: 'fatal: could not read from remote repository' }, recorded, { 'worktree add': {} }),
      { repoPath: '/repo', branch: 'origin/dev' },
    )
    expect(recorded).toEqual([resolve('/repo')])
    expect(outcome.status).toBe(200)
    if (outcome.status !== 200 || !('path' in outcome.body)) throw new Error('expected a creation body')
    expect(outcome.body.created).toBe(true)
    if (!('fetchWarning' in outcome.body) || outcome.body.fetchWarning === undefined) throw new Error('expected a fetchWarning')
    expect(outcome.body.fetchWarning).toContain('could not read')
  })

  it('stages the warning on the cutout path too (a remote base consumes the fetch)', async () => {
    const recorded: string[] = []
    const root = await mkdtemp(join(tmpdir(), 'dsh-gwt-'))
    cleanup.push(root)
    const outcome = await handleCreateWorktree(
      fetchDeps({ code: 1, stderr: 'ssh: connect to host closed' }, recorded, { 'worktree add': {} }),
      { repoPath: '/repo', branch: 'origin/dev', cutout: true, name: 'dev-wt' },
    )
    expect(recorded).toEqual([resolve('/repo')])
    expect(outcome.status).toBe(200)
    if (outcome.status !== 200 || !('path' in outcome.body)) throw new Error('expected a creation body')
    expect(outcome.body.created).toBe(true)
    if (!('fetchWarning' in outcome.body) || outcome.body.fetchWarning === undefined) throw new Error('expected a fetchWarning')
    expect(outcome.body.fetchWarning).toContain('connect to host')
  })
})

describe('handleWorktreesAll', () => {
  /** The default storage root below the fake home (platform separators). */
  const ROOT = join('/home/u', '.dsh', 'gitworktree')

  /** Executor dispatching per cwd: recognized children answer the three-line
   * `rev-parse` probe (the shared .git sits inside the child itself, so the
   * probe's repoName degenerates to the child's own basename — the route
   * passes it through verbatim), everything else refuses. */
  function perDir(table: Record<string, { branch?: string } | 'refuse'>): Exec {
    return async (_file, args, options) => {
      if (args.join(' ') !== 'rev-parse --show-toplevel --git-common-dir --abbrev-ref HEAD') {
        throw new Error(`unexpected git call: git ${args.join(' ')}`)
      }
      const entry = table[options.cwd]
      if (entry === undefined || entry === 'refuse') return { code: 128, stdout: '', stderr: 'fatal: not a git repository' }
      const top = options.cwd
      return { code: 0, stdout: `${top}\n${join(top, '.git')}\n${entry.branch ?? 'HEAD'}\n`, stderr: '' }
    }
  }

  it('answers an empty list for an empty scan', async () => {
    const outcome = await handleWorktreesAll(deps({ listDir: async () => [] }))
    expect(outcome).toEqual({ status: 200, body: { worktrees: [] } })
  })

  it('answers an empty list for a real-fs empty storage root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-gwt-'))
    cleanup.push(root)
    const outcome = await handleWorktreesAll(deps({ sectionRootDir: () => root }))
    expect(outcome).toEqual({ status: 200, body: { worktrees: [] } })
  })

  it('skips plain files in the storage root (real fs)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-gwt-'))
    cleanup.push(root)
    await writeFile(join(root, 'settings.json'), '{"rootDir":""}', 'utf8')
    await mkdir(join(root, 'orphan-dir'))
    const outcome = await handleWorktreesAll(deps({ sectionRootDir: () => root }))
    expect(outcome.status).toBe(200)
    if (outcome.status !== 200 || !('worktrees' in outcome.body)) throw new Error('expected a scan body')
    expect(outcome.body.worktrees.map(entry => entry.path)).toEqual([join(root, 'orphan-dir')])
  })

  it('scans direct children and degrades unrecognized ones to null facts', async () => {
    const wtA = join(ROOT, 'repo-feat-x')
    const wtB = join(ROOT, 'repo-main-wt')
    const junk = join(ROOT, 'leftover')
    const outcome = await handleWorktreesAll(deps({
      listDir: async () => ['repo-feat-x', 'leftover', 'repo-main-wt'],
      exec: perDir({ [wtA]: { branch: 'feat/x' }, [wtB]: { branch: 'main-wt' }, [junk]: 'refuse' }),
    }))
    expect(outcome).toEqual({
      status: 200,
      body: {
        worktrees: [
          { path: wtA, repoName: 'repo-feat-x', branch: 'feat/x' },
          { path: junk, repoName: null, branch: null },
          { path: wtB, repoName: 'repo-main-wt', branch: 'main-wt' },
        ],
      },
    })
  })

  it('keeps one throwing child from sinking its batch (degrades to null facts)', async () => {
    const wtA = join(ROOT, 'repo-feat-x')
    const base = perDir({ [wtA]: { branch: 'feat/x' } })
    const outcome = await handleWorktreesAll(deps({
      listDir: async () => ['repo-feat-x'],
      exec: async (file, args, options) => {
        if (options.cwd === wtA && args.join(' ').includes('abbrev-ref')) throw new Error('spawn exploded')
        return base(file, args, options)
      },
    }))
    expect(outcome.status).toBe(200)
    if (outcome.status !== 200 || !('worktrees' in outcome.body)) throw new Error('expected a scan body')
    expect(outcome.body.worktrees).toEqual([{ path: wtA, repoName: null, branch: null }])
  })

  // A rootDir pointed at something enormous (a home directory, say) must not
  // turn one dialog open into thousands of git spawns.
  it('caps the scan at 512 children and says the list is truncated', async () => {
    const children = Array.from({ length: 600 }, (_, index) => `child-${String(index)}`)
    const outcome = await handleWorktreesAll(deps({
      listDir: async () => children,
      exec: perDir({}),
    }))
    expect(outcome.status).toBe(200)
    if (outcome.status !== 200 || !('worktrees' in outcome.body)) throw new Error('expected a scan body')
    expect(outcome.body.worktrees).toHaveLength(512)
    expect(outcome.body.truncated).toBe(true)
    expect(outcome.body.worktrees.at(-1)?.path).toBe(join(ROOT, 'child-511'))
  })

  it('leaves the truncated flag absent at exactly the cap', async () => {
    const children = Array.from({ length: 512 }, (_, index) => `child-${String(index)}`)
    const outcome = await handleWorktreesAll(deps({
      listDir: async () => children,
      exec: perDir({}),
    }))
    if (outcome.status !== 200 || !('worktrees' in outcome.body)) throw new Error('expected a scan body')
    expect(outcome.body.worktrees).toHaveLength(512)
    expect(outcome.body).not.toHaveProperty('truncated')
  })
})

describe('handlePurgeDirectory', () => {
  const ROOT = join('/home/u', '.dsh', 'gitworktree')

  it('rejects paths outside the storage root and non-directories', async () => {
    expect((await handlePurgeDirectory(deps(), { path: 'wt' })).status).toBe(400)
    expect((await handlePurgeDirectory(deps(), { path: p('/elsewhere/leftover') })).status).toBe(400)
    expect((await handlePurgeDirectory(deps(), { path: join(ROOT, 'a', 'b') })).status).toBe(400)
    const statDirectory = vi.fn(async () => false)
    const outcome = await handlePurgeDirectory(deps({ statDirectory }), { path: join(ROOT, 'gone') })
    expect(outcome.status).toBe(400)
    expect(statDirectory).toHaveBeenCalledWith(resolve(join(ROOT, 'gone')))
  })

  it('refuses a directory git still recognizes (remove it as a worktree instead)', async () => {
    const target = join(ROOT, 'repo-feat-x')
    const base = scripted({ 'rev-parse --show-toplevel --git-common-dir --abbrev-ref HEAD': { stdout: `${target}\n${join(target, '.git')}\nfeat/x\n` } })
    const rmRecursive = vi.fn(async () => {})
    const outcome = await handlePurgeDirectory(
      deps({ exec: base, statDirectory: async () => true, rmRecursive }),
      { path: target },
    )
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected an error body')
    expect(outcome.body.error).toContain('remove it as a worktree')
    expect(rmRecursive).not.toHaveBeenCalled()
  })

  it('deletes a non-git leftover directory (real fs)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-gwt-'))
    cleanup.push(root)
    const target = join(root, 'leftover')
    await mkdir(join(target, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(target, 'node_modules', 'pkg', 'index.js'), 'x', 'utf8')
    const probe = scripted({ 'rev-parse --show-toplevel --git-common-dir --abbrev-ref HEAD': { code: 128, stderr: 'fatal: not a git repository' } })
    const outcome = await handlePurgeDirectory(deps({ sectionRootDir: () => root, exec: probe }), { path: target })
    expect(outcome).toEqual({ status: 200, body: { path: resolve(target), removed: true } })
    await expect(stat(target)).rejects.toThrow()
  })

  it('surfaces an rm failure as a 500 envelope', async () => {
    const rmRecursive = vi.fn(async () => { throw new Error('EBUSY: locked') })
    const outcome = await handlePurgeDirectory(
      deps({ statDirectory: async () => true, rmRecursive, exec: scripted({ 'rev-parse --show-toplevel --git-common-dir --abbrev-ref HEAD': { code: 128, stderr: 'fatal: not a git repository' } }) }),
      { path: join(ROOT, 'leftover') },
    )
    expect(outcome.status).toBe(500)
    if (!('error' in outcome.body)) throw new Error('expected an error body')
    expect(outcome.body.error).toContain('EBUSY')
  })
})
