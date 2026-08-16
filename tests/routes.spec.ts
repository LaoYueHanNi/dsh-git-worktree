import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, normalize } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Exec, ExecResult } from '../src/git.ts'
import {
  handleCreateWorktree, handleGetSettings, handlePutSettings, handleStatus, handleSwitch,
  type RouteDeps,
} from '../src/routes.ts'
import { resolveRootDir } from '../src/settings.ts'

/** Platform-correct expectation for a scripted POSIX-shaped path. */
const p = (value: string): string => normalize(value)

/** The default storage root below a fake home (platform-correct separators). */
const DEFAULT_ROOT = join('/home/u', '.dsh', 'gitworktree')

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

/** Mutable per-test settings state; deps() wires it through. */
function statefulDeps(over: Partial<RouteDeps> = {}): RouteDeps {
  let stored = { rootDir: '' }
  return {
    exec: scripted(REPO_CALLS),
    settingsFile: '/nowhere/settings.json',
    cachedSettings: () => stored,
    storeSettings: async (value) => { stored = value },
    home: () => '/home/u',
    dirExists: () => true,
    ...over,
  }
}

function deps(over: Partial<RouteDeps> = {}): RouteDeps {
  return statefulDeps(over)
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
    const outcome = await handleStatus(deps({ cachedSettings: () => ({ rootDir: 'D:\\wt-root' }) }), '/repo')
    if (!('repo' in outcome.body) || !outcome.body.repo) throw new Error('expected repo facts')
    expect(outcome.body.rootDir).toBe('D:\\wt-root')
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
      deps({ cachedSettings: () => ({ rootDir: 'wt/root' }) }),
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
      deps({ exec: scripted(calls), cachedSettings: () => ({ rootDir: root }) }),
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
  it('defaults to ~/.dsh/gitworktree', () => {
    expect(resolveRootDir({ rootDir: '' }, '/home/u')).toBe(DEFAULT_ROOT)
    expect(resolveRootDir({ rootDir: '   ' }, '/home/u')).toBe(DEFAULT_ROOT)
  })

  it('uses a configured root verbatim', () => {
    expect(resolveRootDir({ rootDir: ' D:\\wt ' }, '/home/u')).toBe('D:\\wt')
  })
})

describe('settings handlers', () => {
  it('GET answers defaults when no document exists', async () => {
    const outcome = await handleGetSettings(deps())
    expect(outcome).toEqual({ status: 200, body: { rootDir: '' } })
  })

  it('GET answers the stored document', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'dsh-gwt-')), 'settings.json')
    cleanup.push(dirname(file))
    await writeFile(file, '{"rootDir":"D:\\\\wt"}\n', 'utf8')
    const outcome = await handleGetSettings(deps({ settingsFile: file }))
    expect(outcome).toEqual({ status: 200, body: { rootDir: 'D:\\wt' } })
  })

  it('PUT persists, advances the cache, and echoes the trimmed value', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-gwt-'))
    cleanup.push(dir)
    const d = statefulDeps({ settingsFile: join(dir, 'settings.json') })
    const outcome = await handlePutSettings(d, { rootDir: ' D:\\wt ' })
    expect(outcome).toEqual({ status: 200, body: { rootDir: 'D:\\wt' } })
    expect(d.cachedSettings()).toEqual({ rootDir: 'D:\\wt' })
    expect(await handleGetSettings(d)).toEqual({ status: 200, body: { rootDir: 'D:\\wt' } })
  })

  it('PUT rejects a relative rootDir without writing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-gwt-'))
    cleanup.push(dir)
    const d = statefulDeps({ settingsFile: join(dir, 'settings.json') })
    const outcome = await handlePutSettings(d, { rootDir: 'wt/root' })
    expect(outcome.status).toBe(400)
    expect(d.cachedSettings()).toEqual({ rootDir: '' })
  })

  it('PUT rejects unknown or mistyped keys', async () => {
    expect((await handlePutSettings(deps(), { rootDir: 'D:\\wt', extra: 1 })).status).toBe(400)
    expect((await handlePutSettings(deps(), { rootDir: 5 })).status).toBe(400)
    expect((await handlePutSettings(deps(), null)).status).toBe(400)
  })
})
