import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Exec, ExecResult } from '../src/git.ts'
import {
  handleCreateWorktree, handleStatus, handleSwitch,
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
    const outcome = await handleCreateWorktree(deps({ exec: scripted(calls) }), { repoPath: '/repo', branch: 'dev' })
    expect(outcome.status).toBe(400)
    if (!('error' in outcome.body)) throw new Error('expected error body')
    expect(outcome.body.error).toContain('fatal')
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
