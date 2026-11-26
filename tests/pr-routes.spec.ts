import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { childProcessExec, readWorktreeBaseBranch, readWorktreePrSha, type Exec, type ExecResult } from '../src/git.ts'
import type { ForgeServiceLike } from '../src/pr.ts'
import { handlePrCheckout, handlePrContext, handlePrResolve, type RouteDeps } from '../src/routes.ts'
import type { PrCheckoutResult, PrContextResult, PrResolveResult, RouteError, SyncEvent } from '../src/wire.ts'

const execFileAsync = promisify(execFile)
const cleanup: string[] = []

afterEach(async () => {
  while (cleanup.length > 0) {
    const dir = cleanup.pop()
    if (dir === undefined) continue
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 }).catch(() => {})
  }
})

function scripted(table: Record<string, Partial<ExecResult>>): Exec {
  return async (_file, args) => {
    const key = args.join(' ')
    const entry = Object.entries(table).find(([prefix]) => key === prefix || key.startsWith(prefix))
    if (entry === undefined) throw new Error(`unexpected git call: git ${key}`)
    return { code: 0, stdout: '', stderr: '', ...entry[1] }
  }
}

function makeDeps(over: Partial<RouteDeps> = {}): RouteDeps {
  return {
    exec: scripted({
      'rev-parse --show-toplevel --git-common-dir --abbrev-ref HEAD': { stdout: '/repo\n/repo/.git\nmain\n' },
      'for-each-ref refs/heads': { stdout: 'main\n' },
      'for-each-ref refs/remotes': { stdout: 'origin/main\n' },
      'worktree list --porcelain': { stdout: 'worktree /repo\nHEAD 1\nbranch refs/heads/main\n' },
      'remote -v': {
        stdout: 'origin\thttps://github.com/org/app.git (fetch)\norigin\thttps://github.com/org/app.git (push)\n',
      },
    }),
    sectionRootDir: () => undefined,
    sectionFetchBeforeCreate: () => undefined,
    home: () => '/home/u',
    envHome: () => undefined,
    dirExists: () => true,
    mkdirRecursive: async () => {},
    excludeSeams: { readFile: async () => '', appendFile: async () => {}, mkdir: async () => {} },
    ...over,
  }
}

async function runGit(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return stdout.trim()
}

describe('handlePrContext and handlePrResolve', () => {
  it('returns native-Git fallback context when forge is absent', async () => {
    const outcome = await handlePrContext(makeDeps(), { repoPath: '/repo' })
    expect(outcome.status).toBe(200)
    const body = outcome.body as PrContextResult
    expect(body.defaultRemote).toBe('origin')
    expect(body.forge).toEqual({ available: false, readiness: 'unsupported' })
    expect(body.candidates).toEqual([])
  })

  it('loads and deduplicates candidates from optional forge service when ready', async () => {
    const forge: ForgeServiceLike = {
      repositoryFromRemote: () => ({ forge: 'github', host: 'github.com', owner: 'org', name: 'app' }),
      changeRequestFromUrl: () => undefined,
      changeRequestUrl: ref => `https://github.com/${ref.repository.owner}/${ref.repository.name}/pull/${ref.number}`,
      readiness: async () => ({ state: 'ready', message: null, signIn: null }),
      listForViewer: async (_forge, query) => {
        if (query.filter === 'review-requested') {
          return {
            viewer: 'me',
            total: 1,
            items: [{
              ref: { repository: { forge: 'github', host: 'github.com', owner: 'org', name: 'app' }, number: 12 },
              url: 'https://github.com/org/app/pull/12',
              title: 'Add feature X',
              draft: false,
              author: { login: 'alice' },
              checksRollup: 'success',
              reviewDecision: 'review-required',
              updatedAt: '2026-11-26T10:00:00Z',
            }],
          }
        }
        return { viewer: 'me', total: 0, items: [] }
      },
    }

    const outcome = await handlePrContext(makeDeps({ forge: () => forge }), { repoPath: '/repo' })
    expect(outcome.status).toBe(200)
    const body = outcome.body as PrContextResult
    expect(body.forge).toEqual({ available: true, readiness: 'ready' })
    expect(body.candidates).toHaveLength(1)
    expect(body.candidates[0]).toMatchObject({
      number: 12,
      localBranch: 'github-pr-12',
      remote: 'origin',
      title: 'Add feature X',
    })
  })

  it('degrades gracefully when forge reports unauthenticated', async () => {
    const forge: ForgeServiceLike = {
      repositoryFromRemote: () => ({ forge: 'github', host: 'github.com', owner: 'org', name: 'app' }),
      changeRequestFromUrl: () => undefined,
      changeRequestUrl: () => '',
      readiness: async () => ({
        state: 'unauthenticated',
        message: 'not logged in',
        signIn: { command: 'gh auth login --hostname github.com' },
      }),
    }
    const outcome = await handlePrContext(makeDeps({ forge: () => forge }), { repoPath: '/repo' })
    expect(outcome.status).toBe(200)
    const body = outcome.body as PrContextResult
    expect(body.forge).toEqual({
      available: true,
      readiness: 'unauthenticated',
      signInCommand: 'gh auth login --hostname github.com',
      message: 'not logged in',
    })
    expect(body.candidates).toEqual([])
  })

  it('resolves numeric PR and reports existing worktree without touching git', async () => {
    const wtPath = join('/repo', '.dsh', 'gitworktree', 'github-pr-42')
    const deps = makeDeps({
      exec: scripted({
        'rev-parse --show-toplevel --git-common-dir --abbrev-ref HEAD': { stdout: '/repo\n/repo/.git\nmain\n' },
        'for-each-ref refs/heads': { stdout: 'main\ngithub-pr-42\n' },
        'for-each-ref refs/remotes': { stdout: 'origin/main\n' },
        'worktree list --porcelain': {
          stdout: `worktree /repo\nHEAD 1\nbranch refs/heads/main\n\nworktree ${wtPath}\nHEAD 2\nbranch refs/heads/github-pr-42\n`,
        },
        'remote -v': { stdout: 'origin\thttps://github.com/org/app.git (fetch)\n' },
      }),
    })
    const outcome = await handlePrResolve(deps, { repoPath: '/repo', input: '42' })
    expect(outcome.status).toBe(200)
    const body = outcome.body as PrResolveResult
    expect(body.existingWorktreePath).toBe(normalize(wtPath))
    expect(body.existingBranch).toBe(true)
  })

  it('rejects checkout with occupied_by_main when the main worktree already holds the PR branch', async () => {
    const deps = makeDeps({
      exec: scripted({
        'rev-parse --show-toplevel --git-common-dir --abbrev-ref HEAD': { stdout: '/repo\n/repo/.git\ngithub-pr-42\n' },
        'for-each-ref refs/heads': { stdout: 'main\ngithub-pr-42\n' },
        'for-each-ref refs/remotes': { stdout: 'origin/main\n' },
        'worktree list --porcelain': { stdout: 'worktree /repo\nHEAD 1\nbranch refs/heads/github-pr-42\n' },
        'remote -v': { stdout: 'origin\thttps://github.com/org/app.git (fetch)\n' },
      }),
    })
    const outcome = await handlePrCheckout(deps, { repoPath: '/repo', input: '42' })
    expect(outcome.status).toBe(400)
    expect((outcome.body as RouteError).code).toBe('occupied_by_main')
  })
})

describe('handlePrCheckout real git integration', () => {
  it('checks out refs/pull/<id>/head into an isolated worktree without changing main HEAD, and handles reuse/update/dirty safely', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-wt-pr-'))
    cleanup.push(root)

    const bareDir = join(root, 'remote.git')
    const seedDir = join(root, 'seed')
    const mainDir = join(root, 'main-repo')

    await mkdir(bareDir, { recursive: true })
    await runGit(bareDir, 'init', '--bare', '--initial-branch=main')

    await runGit(root, 'clone', bareDir, seedDir)
    await runGit(seedDir, 'config', 'user.email', 'test@example.com')
    await runGit(seedDir, 'config', 'user.name', 'Test User')
    await writeFile(join(seedDir, 'README.md'), 'base\n', 'utf8')
    await runGit(seedDir, 'add', 'README.md')
    await runGit(seedDir, 'commit', '-m', 'init')
    await runGit(seedDir, 'push', 'origin', 'main')

    // Simulate a fork PR ref (refs/pull/12/head) on the remote that is NOT under refs/heads/*
    await runGit(seedDir, 'checkout', '-b', 'pr-work')
    await writeFile(join(seedDir, 'pr.txt'), 'pr v1\n', 'utf8')
    await runGit(seedDir, 'add', 'pr.txt')
    await runGit(seedDir, 'commit', '-m', 'pr commit 1')
    const prSha1 = await runGit(seedDir, 'rev-parse', 'HEAD')
    await runGit(seedDir, 'push', 'origin', `${prSha1}:refs/pull/12/head`)

    await runGit(root, 'clone', bareDir, mainDir)
    await runGit(mainDir, 'config', 'user.email', 'test@example.com')
    await runGit(mainDir, 'config', 'user.name', 'Test User')
    await runGit(mainDir, 'remote', 'set-url', 'origin', bareDir)
    const mainHeadBefore = await runGit(mainDir, 'rev-parse', 'HEAD')

    const realDeps: RouteDeps = {
      exec: childProcessExec,
      sectionRootDir: () => undefined,
      sectionFetchBeforeCreate: () => undefined,
      home: () => root,
      envHome: () => undefined,
    }

    const events: SyncEvent[] = []
    const checkout1 = await handlePrCheckout(
      realDeps,
      { repoPath: mainDir, input: '12', provider: 'github' },
      { signal: new AbortController().signal, emit: e => events.push(e) },
    )
    expect(checkout1.status).toBe(200)
    const res1 = checkout1.body as PrCheckoutResult
    expect(res1.created).toBe(true)
    expect(res1.branch).toBe('github-pr-12')
    expect(events.some(e => e.type === 'stage' && e.stage === 'fetch')).toBe(true)
    expect(events.some(e => e.type === 'stage' && e.stage === 'worktree')).toBe(true)

    // Main checkout HEAD stays untouched
    expect(await runGit(mainDir, 'rev-parse', 'HEAD')).toBe(mainHeadBefore)
    expect(await runGit(mainDir, 'branch', '--show-current')).toBe('main')
    // Isolated worktree has the PR commit and persisted PR metadata
    expect(await readFile(join(res1.path, 'pr.txt'), 'utf8')).toBe('pr v1\n')
    expect(await runGit(res1.path, 'rev-parse', 'HEAD')).toBe(prSha1)
    expect(await readWorktreePrSha(res1.path)).toBe(prSha1)
    expect(await readWorktreeBaseBranch(res1.path)).toBe('PR #12')

    // Reuse existing worktree returns created: false without touching git
    const reuse = await handlePrCheckout(realDeps, { repoPath: mainDir, input: '12', provider: 'github', ifExists: 'reuse' })
    expect(reuse.status).toBe(200)
    expect((reuse.body as PrCheckoutResult).created).toBe(false)

    // Push a second commit to refs/pull/12/head and fast-forward update clean worktree
    await writeFile(join(seedDir, 'pr.txt'), 'pr v2\n', 'utf8')
    await runGit(seedDir, 'add', 'pr.txt')
    await runGit(seedDir, 'commit', '-m', 'pr commit 2')
    const prSha2 = await runGit(seedDir, 'rev-parse', 'HEAD')
    await runGit(seedDir, 'push', 'origin', `${prSha2}:refs/pull/12/head`)

    const updated = await handlePrCheckout(realDeps, { repoPath: mainDir, input: '12', provider: 'github', ifExists: 'update' })
    expect(updated.status).toBe(200)
    expect((updated.body as PrCheckoutResult).updated).toBe(true)
    expect((updated.body as PrCheckoutResult).forceUpdated).toBeUndefined()
    expect(await runGit(res1.path, 'rev-parse', 'HEAD')).toBe(prSha2)
    expect(await readWorktreePrSha(res1.path)).toBe(prSha2)

    // Author force-pushes (amend) refs/pull/12/head while local PR worktree has zero local commits -> auto safe sync
    await writeFile(join(seedDir, 'pr.txt'), 'pr v2 amended\n', 'utf8')
    await runGit(seedDir, 'add', 'pr.txt')
    await runGit(seedDir, 'commit', '--amend', '-m', 'pr commit 2 amended')
    const prSha3 = await runGit(seedDir, 'rev-parse', 'HEAD')
    await runGit(seedDir, 'push', '--force', 'origin', `${prSha3}:refs/pull/12/head`)

    const forceSynced = await handlePrCheckout(realDeps, { repoPath: mainDir, input: '12', provider: 'github', ifExists: 'update' })
    expect(forceSynced.status).toBe(200)
    expect((forceSynced.body as PrCheckoutResult).updated).toBe(true)
    expect((forceSynced.body as PrCheckoutResult).forceUpdated).toBe(true)
    expect(await runGit(res1.path, 'rev-parse', 'HEAD')).toBe(prSha3)
    expect(await readWorktreePrSha(res1.path)).toBe(prSha3)

    // Local reviewer makes a commit, then PR author pushes another commit -> update refuses with 409 worktree_diverged
    await writeFile(join(res1.path, 'local-note.txt'), 'reviewer commit\n', 'utf8')
    await runGit(res1.path, 'add', 'local-note.txt')
    await runGit(res1.path, 'commit', '-m', 'local reviewer commit')
    const localHead = await runGit(res1.path, 'rev-parse', 'HEAD')

    await writeFile(join(seedDir, 'pr.txt'), 'pr v3\n', 'utf8')
    await runGit(seedDir, 'add', 'pr.txt')
    await runGit(seedDir, 'commit', '-m', 'pr commit 3')
    const prSha4 = await runGit(seedDir, 'rev-parse', 'HEAD')
    await runGit(seedDir, 'push', '--force', 'origin', `${prSha4}:refs/pull/12/head`)

    const diverged = await handlePrCheckout(realDeps, { repoPath: mainDir, input: '12', provider: 'github', ifExists: 'update' })
    expect(diverged.status).toBe(409)
    expect((diverged.body as RouteError).code).toBe('worktree_diverged')
    expect((diverged.body as RouteError).params).toEqual({ branch: 'github-pr-12' })
    expect(await runGit(res1.path, 'rev-parse', 'HEAD')).toBe(localHead)

    // Explicit reset after user confirmation resets to latest PR tip
    const resetOutcome = await handlePrCheckout(realDeps, { repoPath: mainDir, input: '12', provider: 'github', ifExists: 'reset' })
    expect(resetOutcome.status).toBe(200)
    expect((resetOutcome.body as PrCheckoutResult).updated).toBe(true)
    expect((resetOutcome.body as PrCheckoutResult).reset).toBe(true)
    expect(await runGit(res1.path, 'rev-parse', 'HEAD')).toBe(prSha4)
    expect(await readWorktreePrSha(res1.path)).toBe(prSha4)

    // Untracked & .gitignore-ignored config files (such as .worktreeinclude copies like .env.local) do not block non-colliding PR updates
    await writeFile(join(res1.path, '.env.local'), 'TOKEN=keep-me\n', 'utf8')
    await writeFile(join(seedDir, '.gitignore'), '.env.local\n', 'utf8')
    await writeFile(join(seedDir, 'pr.txt'), 'pr v4\n', 'utf8')
    await runGit(seedDir, 'add', '.gitignore', 'pr.txt')
    await runGit(seedDir, 'commit', '-m', 'pr commit 4 with gitignore')
    const prSha5 = await runGit(seedDir, 'rev-parse', 'HEAD')
    await runGit(seedDir, 'push', 'origin', `${prSha5}:refs/pull/12/head`)

    const updateWithIgnored = await handlePrCheckout(realDeps, { repoPath: mainDir, input: '12', provider: 'github', ifExists: 'update' })
    expect(updateWithIgnored.status).toBe(200)
    expect((updateWithIgnored.body as PrCheckoutResult).updated).toBe(true)
    expect(await runGit(res1.path, 'rev-parse', 'HEAD')).toBe(prSha5)
    expect(await readFile(join(res1.path, '.env.local'), 'utf8')).toBe('TOKEN=keep-me\n')

    // Fast-forward update refuses to silently overwrite a colliding .gitignore-ignored file
    await writeFile(join(seedDir, '.env.local'), 'TRACKED_ENV=from-ff-pr\n', 'utf8')
    await runGit(seedDir, 'add', '-f', '.env.local')
    await runGit(seedDir, 'commit', '-m', 'pr commit 5 force-adding ignored .env.local')
    const prSha5FfCollision = await runGit(seedDir, 'rev-parse', 'HEAD')
    await runGit(seedDir, 'push', 'origin', `${prSha5FfCollision}:refs/pull/12/head`)

    const ffCollisionUpdate = await handlePrCheckout(realDeps, { repoPath: mainDir, input: '12', provider: 'github', ifExists: 'update' })
    expect(ffCollisionUpdate.status).toBe(400)
    expect((ffCollisionUpdate.body as RouteError).error).toContain('.env.local')
    expect(await runGit(res1.path, 'rev-parse', 'HEAD')).toBe(prSha5)
    expect(await readFile(join(res1.path, '.env.local'), 'utf8')).toBe('TOKEN=keep-me\n')

    // Force-push auto-reset also refuses to overwrite the colliding .gitignore-ignored file
    await runGit(seedDir, 'reset', '--hard', 'HEAD~1')
    await writeFile(join(seedDir, '.env.local'), 'TRACKED_ENV=from-force-push-pr\n', 'utf8')
    await runGit(seedDir, 'add', '-f', '.env.local')
    await runGit(seedDir, 'commit', '--amend', '-m', 'pr commit 4 amended with ignored .env.local')
    const prSha5ForceCollision = await runGit(seedDir, 'rev-parse', 'HEAD')
    await runGit(seedDir, 'push', '--force', 'origin', `${prSha5ForceCollision}:refs/pull/12/head`)

    const forceCollisionUpdate = await handlePrCheckout(realDeps, { repoPath: mainDir, input: '12', provider: 'github', ifExists: 'update' })
    expect(forceCollisionUpdate.status).toBe(400)
    expect((forceCollisionUpdate.body as RouteError).error).toContain('.env.local')
    expect(await runGit(res1.path, 'rev-parse', 'HEAD')).toBe(prSha5)
    expect(await readFile(join(res1.path, '.env.local'), 'utf8')).toBe('TOKEN=keep-me\n')

    // Tracked uncommitted changes refuse update with structured worktree_dirty code
    await writeFile(join(res1.path, 'pr.txt'), 'local dirty tracked change\n', 'utf8')
    const dirtyUpdate = await handlePrCheckout(realDeps, { repoPath: mainDir, input: '12', provider: 'github', ifExists: 'update' })
    expect(dirtyUpdate.status).toBe(400)
    expect((dirtyUpdate.body as RouteError).code).toBe('worktree_dirty')

    // Temporary fetch refs are always cleaned up
    expect(await runGit(mainDir, 'for-each-ref', 'refs/dsh-pr-tmp')).toBe('')
  }, 30_000)

  it('supports GitLab MR refs, preserves local unmerged branches without a worktree, and honours AbortSignal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-wt-mr-'))
    cleanup.push(root)

    const bareDir = join(root, 'gitlab.git')
    const seedDir = join(root, 'seed')
    const mainDir = join(root, 'main-repo')

    await mkdir(bareDir, { recursive: true })
    await runGit(bareDir, 'init', '--bare', '--initial-branch=main')

    await runGit(root, 'clone', bareDir, seedDir)
    await runGit(seedDir, 'config', 'user.email', 'test@example.com')
    await runGit(seedDir, 'config', 'user.name', 'Test User')
    await writeFile(join(seedDir, 'README.md'), 'base\n', 'utf8')
    await runGit(seedDir, 'add', 'README.md')
    await runGit(seedDir, 'commit', '-m', 'init')
    await runGit(seedDir, 'push', 'origin', 'main')

    await runGit(seedDir, 'checkout', '-b', 'mr-17-branch')
    await writeFile(join(seedDir, 'mr-17.txt'), 'gitlab mr 17\n', 'utf8')
    await runGit(seedDir, 'add', 'mr-17.txt')
    await runGit(seedDir, 'commit', '-m', 'mr 17 commit')
    const mrSha = await runGit(seedDir, 'rev-parse', 'HEAD')
    await runGit(seedDir, 'push', 'origin', `${mrSha}:refs/merge-requests/17/head`)

    await runGit(root, 'clone', bareDir, mainDir)
    await runGit(mainDir, 'config', 'user.email', 'test@example.com')
    await runGit(mainDir, 'config', 'user.name', 'Test User')
    await runGit(mainDir, 'remote', 'set-url', 'origin', bareDir)

    const realDeps: RouteDeps = {
      exec: childProcessExec,
      sectionRootDir: () => undefined,
      sectionFetchBeforeCreate: () => undefined,
      home: () => root,
      envHome: () => undefined,
    }

    // Pre-aborted AbortSignal cancels streaming fetch without creating a worktree
    const aborted = new AbortController()
    aborted.abort()
    const cancelledOutcome = await handlePrCheckout(
      realDeps,
      { repoPath: mainDir, input: '!17', provider: 'gitlab' },
      { signal: aborted.signal, emit: () => {} },
    )
    expect(cancelledOutcome.status).toBe(499)

    // Real GitLab MR checkout (!17 -> refs/merge-requests/17/head -> gitlab-mr-17)
    const mrOutcome = await handlePrCheckout(realDeps, { repoPath: mainDir, input: '!17', provider: 'gitlab' })
    expect(mrOutcome.status).toBe(200)
    const mrRes = mrOutcome.body as PrCheckoutResult
    expect(mrRes.created).toBe(true)
    expect(mrRes.branch).toBe('gitlab-mr-17')
    expect(await runGit(mrRes.path, 'rev-parse', 'HEAD')).toBe(mrSha)
    expect(await readWorktreeBaseBranch(mrRes.path)).toBe('MR !17')
    expect(await readFile(join(mrRes.path, 'mr-17.txt'), 'utf8')).toBe('gitlab mr 17\n')

    // Pre-existing local branch with diverged commits and no worktree is preserved untouched
    await runGit(mainDir, 'checkout', '-b', 'gitlab-mr-21')
    await writeFile(join(mainDir, 'local-only.txt'), 'keep local branch commit\n', 'utf8')
    await runGit(mainDir, 'add', 'local-only.txt')
    await runGit(mainDir, 'commit', '-m', 'local diverged commit')
    const localBranchSha = await runGit(mainDir, 'rev-parse', 'HEAD')
    await runGit(mainDir, 'checkout', 'main')
    await runGit(seedDir, 'push', 'origin', `${mrSha}:refs/merge-requests/21/head`)

    const preservedOutcome = await handlePrCheckout(realDeps, { repoPath: mainDir, input: '!21', provider: 'gitlab' })
    expect(preservedOutcome.status).toBe(200)
    const preservedRes = preservedOutcome.body as PrCheckoutResult
    expect(preservedRes.created).toBe(true)
    expect(preservedRes.preservedLocalBranch).toBe(true)
    expect(await runGit(preservedRes.path, 'rev-parse', 'HEAD')).toBe(localBranchSha)
  }, 30_000)
})
