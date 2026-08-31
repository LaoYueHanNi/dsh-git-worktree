import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Exec, ExecResult } from '../src/git.ts'
import {
  handleCreateBranch, handleCreateWorktree, handleFetch, handleStatus, handleSwitch, handleUpdate,
  type RouteDeps,
} from '../src/routes.ts'
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

function deps(over: Partial<RouteDeps> = {}): RouteDeps {
  return {
    exec: scripted(REPO_CALLS),
    sectionRootDir: () => undefined,
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

  it('rejects unknown body keys', async () => {
    expect((await handleCreateBranch(deps(), { repoPath: '/repo', name: 'dev', from: 'main' })).status).toBe(400)
    expect((await handleCreateBranch(deps(), null)).status).toBe(400)
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
