import { describe, expect, it } from 'vitest'
import { normalize, resolve } from 'node:path'
import {
  addWorktree, addWorktreeCutout, createBranch, cutoutBranchName, fetchAll, inspectWorktree, probeRepo, probeWorkspaceGit, removeWorktree, switchBranch, updateBranch,
  type Exec, type ExecResult,
} from '../src/git.ts'

/** Platform-correct expectation for a scripted POSIX-shaped path. */
const p = (value: string): string => normalize(value)

/**
 * Scripted executor: each entry is tested in order against the argument list
 * (a prefix match), answering the scripted result; an unmatched call fails
 * the test so argument drift cannot pass silently.
 */
function scripted(calls: readonly { args: readonly string[]; out: Partial<ExecResult> }[]): Exec {
  let at = 0
  return async (_file, args) => {
    const entry = calls[at]
    at += 1
    if (entry === undefined) throw new Error(`unexpected git call #${at}: git ${args.join(' ')}`)
    const matches = entry.args.length <= args.length
      && entry.args.every((want, i) => want === args[i])
    if (!matches) throw new Error(`git call #${at} wanted [${entry.args.join(' ')}] got [${args.join(' ')}]`)
    return { code: 0, stdout: '', stderr: '', ...entry.out }
  }
}

/** Porcelain listing for two worktrees: main on main, linked on feat-x. */
const TWO_WORKTREES = [
  'worktree /repo',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /root/repo/feat-x',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/feat-x',
  '',
].join('\n')

describe('probeRepo', () => {
  it('assembles facts from rev-parse, branch refs, and worktree porcelain', async () => {
    const exec = scripted([
      { args: ['rev-parse', '--show-toplevel'], out: { stdout: '/repo\n' } },
      { args: ['rev-parse', '--git-common-dir'], out: { stdout: '/repo/.git\n' } },
      { args: ['branch', '--show-current'], out: { stdout: 'main\n' } },
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main[ahead 1, behind 2]\nfeat-x\n' } },
      { args: ['for-each-ref', 'refs/remotes'], out: { stdout: 'origin/HEAD\norigin/main\norigin/dev\nupstream/dev\n' } },
      { args: ['worktree', 'list', '--porcelain'], out: { stdout: TWO_WORKTREES } },
    ])
    const facts = await probeRepo(exec, '/repo/sub', () => true)
    expect(facts).toBeDefined()
    expect(facts?.repoName).toBe('repo')
    expect(facts?.currentBranch).toBe('main')
    // Every remote's remote-only branches come through: `<remote>/HEAD` and
    // branches with a local twin (origin/main) drop, the rest keep their
    // remote prefix — origin and upstream side by side, no first-remote fold.
    // Local rows carry their upstream track: main diverges, feat-x (no
    // upstream) gets no counts.
    expect(facts?.branches).toEqual([
      { name: 'main', kind: 'local', ahead: 1, behind: 2 },
      { name: 'feat-x', kind: 'local' },
      { name: 'origin/dev', kind: 'remote' },
      { name: 'upstream/dev', kind: 'remote' },
    ])
    expect(facts?.worktrees).toEqual([
      { path: p('/repo'), branch: 'main', main: true },
      { path: p('/root/repo/feat-x'), branch: 'feat-x', main: false },
    ])
  })

  it('reports undefined outside a repository', async () => {
    const exec = scripted([
      { args: ['rev-parse', '--show-toplevel'], out: { code: 128, stderr: 'fatal: not a git repository\n' } },
    ])
    expect(await probeRepo(exec, '/plain', () => true)).toBeUndefined()
  })

  it('names the repository from the common dir inside a linked worktree', async () => {
    const exec = scripted([
      { args: ['rev-parse', '--show-toplevel'], out: { stdout: '/root/repo/feat-x\n' } },
      { args: ['rev-parse', '--git-common-dir'], out: { stdout: '/root/repo/.git\n' } },
      { args: ['branch', '--show-current'], out: { stdout: 'feat-x\n' } },
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main\nfeat-x\n' } },
      { args: ['for-each-ref', 'refs/remotes'], out: { code: 0, stdout: '' } },
      { args: ['worktree', 'list', '--porcelain'], out: { stdout: TWO_WORKTREES } },
    ])
    const facts = await probeRepo(exec, '/root/repo/feat-x/src', () => true)
    expect(facts?.repoName).toBe('repo')
    expect(facts?.currentBranch).toBe('feat-x')
  })

  it('marks a detached worktree branchless', async () => {
    const porcelain = ['worktree /repo', 'HEAD 111', 'branch refs/heads/main', '', 'worktree /wt', 'HEAD 222', 'detached', ''].join('\n')
    const exec = scripted([
      { args: ['rev-parse', '--show-toplevel'], out: { stdout: '/repo\n' } },
      { args: ['rev-parse', '--git-common-dir'], out: { stdout: '/repo/.git\n' } },
      { args: ['branch', '--show-current'], out: { stdout: '' } },
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main\n' } },
      { args: ['for-each-ref', 'refs/remotes'], out: { code: 0, stdout: '' } },
      { args: ['worktree', 'list', '--porcelain'], out: { stdout: porcelain } },
    ])
    const facts = await probeRepo(exec, '/repo', () => true)
    expect(facts?.currentBranch).toBe('HEAD')
    expect(facts?.worktrees[1]).toEqual({ path: p('/wt'), branch: undefined, main: false })
  })

  it('drops gone and in-sync upstream tracks, keeps behind-only counts', async () => {
    const exec = scripted([
      { args: ['rev-parse', '--show-toplevel'], out: { stdout: '/repo\n' } },
      { args: ['rev-parse', '--git-common-dir'], out: { stdout: '/repo/.git\n' } },
      { args: ['branch', '--show-current'], out: { stdout: 'main\n' } },
      // `[gone]` (upstream deleted server-side) carries no counts and must
      // not surface as NaN-ish garbage; an in-sync branch has no bracket.
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main[behind 3]\ndev[gone]\nsync\n' } },
      { args: ['for-each-ref', 'refs/remotes'], out: { code: 0, stdout: '' } },
      { args: ['worktree', 'list', '--porcelain'], out: { stdout: TWO_WORKTREES } },
    ])
    const facts = await probeRepo(exec, '/repo', () => true)
    expect(facts?.branches).toEqual([
      { name: 'main', kind: 'local', behind: 3 },
      { name: 'dev', kind: 'local' },
      { name: 'sync', kind: 'local' },
    ])
  })

  it('skips the bare leftover ref under refs/remotes (no slash below it)', async () => {
    const exec = scripted([
      { args: ['rev-parse', '--show-toplevel'], out: { stdout: '/repo\n' } },
      { args: ['rev-parse', '--git-common-dir'], out: { stdout: '/repo/.git\n' } },
      { args: ['branch', '--show-current'], out: { stdout: 'main\n' } },
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main\n' } },
      // `refs/remotes/origin` (shortname `origin`, no `/`) is a leftover
      // ref, not a remote branch — git branch -r hides it, so must the list.
      // origin/main also hides: its local twin `main` exists.
      { args: ['for-each-ref', 'refs/remotes'], out: { stdout: 'origin\norigin/main\norigin/dev\n' } },
      { args: ['worktree', 'list', '--porcelain'], out: { stdout: TWO_WORKTREES } },
    ])
    const facts = await probeRepo(exec, '/repo', () => true)
    expect(facts?.branches).toEqual([
      { name: 'main', kind: 'local' },
      { name: 'origin/dev', kind: 'remote' },
    ])
  })
})

describe('addWorktree', () => {
  it('reuses the existing worktree for the branch without running add', async () => {
    const exec = scripted([
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main\nfeat-x\n' } },
      { args: ['worktree', 'list', '--porcelain'], out: { stdout: TWO_WORKTREES } },
    ])
    const result = await addWorktree(exec, '/repo', 'feat-x', '/root/repo/feat-x-2', () => true)
    expect(result).toEqual({ path: p('/root/repo/feat-x'), created: false })
  })

  it('adds a local branch when it exists locally', async () => {
    const exec = scripted([
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main\ndev\n' } },
      { args: ['worktree', 'list', '--porcelain'], out: { stdout: 'worktree /repo\nHEAD 1\nbranch refs/heads/main\n' } },
      { args: ['worktree', 'add', '/root/repo/dev', 'dev'] },
    ])
    const result = await addWorktree(exec, '/repo', 'dev', '/root/repo/dev', () => true)
    expect(result).toEqual({ path: '/root/repo/dev', created: true })
  })

  it('creates a local twin for a remote-only branch', async () => {
    const exec = scripted([
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main\n' } },
      { args: ['for-each-ref', 'refs/remotes', 'refs/remotes/origin/dev'], out: { stdout: 'origin/dev\n' } },
      { args: ['worktree', 'list', '--porcelain'], out: { stdout: 'worktree /repo\nHEAD 1\nbranch refs/heads/main\n' } },
      { args: ['worktree', 'add', '/root/repo/dev', '-b', 'dev', 'origin/dev'] },
    ])
    const result = await addWorktree(exec, '/repo', 'origin/dev', '/root/repo/dev', () => true)
    expect(result).toEqual({ path: '/root/repo/dev', created: true })
  })

  it('rejects an unknown branch', async () => {
    const exec = scripted([
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main\n' } },
      { args: ['for-each-ref', 'refs/remotes', 'refs/remotes/nope'], out: { code: 0, stdout: '' } },
    ])
    await expect(addWorktree(exec, '/repo', 'nope', '/root/repo/nope', () => true)).rejects.toThrow('branch "nope" not found')
  })
})

describe('cutoutBranchName', () => {
  it('names the cutout branch <base>-wt when free', async () => {
    const exec = scripted([
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main\ndev\n' } },
    ])
    expect(await cutoutBranchName(exec, '/repo', 'main')).toBe('main-wt')
  })

  it('suffixes -wt<N> past taken names', async () => {
    const exec = scripted([
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main\nmain-wt\nmain-wt2\n' } },
    ])
    expect(await cutoutBranchName(exec, '/repo', 'main')).toBe('main-wt3')
  })

  it('passes a slashed local name and detached HEAD through verbatim', async () => {
    const exec = scripted([
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'feature/x\n' } },
    ])
    expect(await cutoutBranchName(exec, '/repo', 'feature/x')).toBe('feature/x-wt')
    const detached = scripted([
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main\n' } },
    ])
    expect(await cutoutBranchName(detached, '/repo', 'HEAD')).toBe('HEAD-wt')
  })

  it('skips a name whose storage folder is taken though the branch is free', async () => {
    const exec = scripted([
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main\n' } },
    ])
    // A branch deleted by hand leaves its folder behind: `main-wt` must not
    // be planned again, or `worktree add` fails on the existing directory.
    expect(await cutoutBranchName(exec, '/repo', 'main', name => name === 'main-wt')).toBe('main-wt2')
  })

  it('keeps the stem when branch and folder are both free', async () => {
    const exec = scripted([
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main\n' } },
    ])
    expect(await cutoutBranchName(exec, '/repo', 'main', () => false)).toBe('main-wt')
  })
})

describe('addWorktreeCutout', () => {
  it('adds the new branch out of the base into the target', async () => {
    const exec = scripted([
      { args: ['worktree', 'add', '/root/repo/main-wt', '-b', 'main-wt', 'main'] },
    ])
    await expect(addWorktreeCutout(exec, '/repo', 'main', 'main-wt', '/root/repo/main-wt')).resolves.toBeUndefined()
  })

  it('surfaces a git refusal of the base branch', async () => {
    const exec = scripted([
      { args: ['worktree', 'add', '/root/repo/main-wt', '-b', 'main-wt', 'main'],
        out: { code: 128, stderr: 'fatal: invalid reference: main\n' } },
    ])
    await expect(addWorktreeCutout(exec, '/repo', 'main', 'main-wt', '/root/repo/main-wt')).rejects.toThrow('fatal')
  })
})

describe('switchBranch', () => {
  it('switches by local name', async () => {
    const exec = scripted([
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main\ndev\n' } },
      { args: ['switch', 'dev'] },
    ])
    expect(await switchBranch(exec, '/repo', 'dev')).toBe('dev')
  })

  it('switches a remote-only branch through the dwim name', async () => {
    const exec = scripted([
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main\n' } },
      { args: ['for-each-ref', 'refs/remotes', 'refs/remotes/origin/dev'], out: { stdout: 'origin/dev\n' } },
      { args: ['switch', 'dev'] },
    ])
    expect(await switchBranch(exec, '/repo', 'origin/dev')).toBe('dev')
  })
})

describe('createBranch', () => {
  it('runs switch -c at the queried directory and reports the name', async () => {
    const exec = scripted([
      { args: ['switch', '-c', 'feat/auth-login'], out: { stdout: "Switched to a new branch 'feat/auth-login'\n" } },
    ])
    expect(await createBranch(exec, '/repo/wt', 'feat/auth-login')).toBe('feat/auth-login')
  })

  it('surfaces a git refusal of the name', async () => {
    const exec = scripted([
      { args: ['switch', '-c', 'bad..name'],
        out: { code: 128, stderr: "fatal: 'bad..name' is not a valid branch name\n" } },
    ])
    await expect(createBranch(exec, '/repo', 'bad..name')).rejects.toThrow('not a valid branch name')
  })
})

describe('fetchAll', () => {
  it('fetches every remote with prune at the repository root', async () => {
    const exec = scripted([
      { args: ['fetch', '--all', '--prune'], out: { stdout: 'Fetching origin\n' } },
    ])
    await expect(fetchAll(exec, '/repo')).resolves.toBeUndefined()
  })

  it('surfaces a network refusal', async () => {
    const exec = scripted([
      { args: ['fetch', '--all', '--prune'],
        out: { code: 128, stderr: 'fatal: unable to access \'https://example.com/repo.git\': Could not resolve host\n' } },
    ])
    await expect(fetchAll(exec, '/repo')).rejects.toThrow('Could not resolve host')
  })
})

describe('updateBranch', () => {
  it('fetches then fast-forwards HEAD to the upstream', async () => {
    const exec = scripted([
      { args: ['fetch', '--all', '--prune'] },
      { args: ['rev-parse', 'HEAD'], out: { stdout: 'aaa111\n' } },
      { args: ['merge', '--ff-only', '@{u}'], out: { stdout: 'Updating aaa111..bbb222\nFast-forward\n' } },
      { args: ['rev-parse', 'HEAD'], out: { stdout: 'bbb222\n' } },
      { args: ['branch', '--show-current'], out: { stdout: 'main\n' } },
    ])
    expect(await updateBranch(exec, '/repo')).toEqual({ branch: 'main', updated: true })
  })

  it('reports a no-op when the upstream already contains HEAD', async () => {
    const exec = scripted([
      { args: ['fetch', '--all', '--prune'] },
      { args: ['rev-parse', 'HEAD'], out: { stdout: 'aaa111\n' } },
      { args: ['merge', '--ff-only', '@{u}'], out: { stdout: 'Already up to date.\n' } },
      { args: ['rev-parse', 'HEAD'], out: { stdout: 'aaa111\n' } },
      { args: ['branch', '--show-current'], out: { stdout: 'main\n' } },
    ])
    expect(await updateBranch(exec, '/repo')).toEqual({ branch: 'main', updated: false })
  })

  it('surfaces a fast-forward refusal on a diverged branch', async () => {
    const exec = scripted([
      { args: ['fetch', '--all', '--prune'] },
      { args: ['rev-parse', 'HEAD'], out: { stdout: 'aaa111\n' } },
      { args: ['merge', '--ff-only', '@{u}'],
        out: { code: 128, stderr: 'fatal: Not possible to fast-forward, aborting.\n' } },
    ])
    await expect(updateBranch(exec, '/repo')).rejects.toThrow('Not possible to fast-forward')
  })
})

describe('probeWorkspaceGit', () => {
  /** Platform-real directory shapes — Windows runs get drive-qualified paths. */
  const REPO = resolve('/repo')
  const WT = resolve('/wt/feat-x')
  /** Git porcelain prints forward slashes even on Windows. */
  const slashes = (value: string): string => value.replace(/\\/g, '/')

  it('marks a main checkout main and reports its branch', async () => {
    const exec = scripted([
      { args: ['rev-parse', '--show-toplevel'], out: { stdout: `${slashes(REPO)}\n` } },
      { args: ['rev-parse', '--git-common-dir'], out: { stdout: '.git\n' } },
      { args: ['branch', '--show-current'], out: { stdout: 'main\n' } },
    ])
    expect(await probeWorkspaceGit(exec, REPO)).toEqual({
      repoRoot: REPO, repoName: 'repo', branch: 'main', main: true,
    })
  })

  it('groups a linked worktree under the main repository its common dir names', async () => {
    const exec = scripted([
      { args: ['rev-parse', '--show-toplevel'], out: { stdout: `${slashes(WT)}\n` } },
      // GIT_COMMON_DIR of a linked worktree is the path back to the SHARED
      // `<repo>/.git` — real git often prints it relative to the worktree.
      { args: ['rev-parse', '--git-common-dir'], out: { stdout: '../../repo/.git\n' } },
      { args: ['branch', '--show-current'], out: { stdout: 'feat-x\n' } },
    ])
    // Same grouping key as the main checkout probe above: both resolve the
    // common dir to `<REPO>/.git`, both answer repoRoot REPO.
    expect(await probeWorkspaceGit(exec, WT)).toEqual({
      repoRoot: REPO, repoName: 'repo', branch: 'feat-x', main: false,
    })
  })

  it('normalizes a detached or unborn HEAD to a null branch', async () => {
    const exec = scripted([
      { args: ['rev-parse', '--show-toplevel'], out: { stdout: `${slashes(REPO)}\n` } },
      { args: ['rev-parse', '--git-common-dir'], out: { stdout: '.git\n' } },
      { args: ['branch', '--show-current'], out: { stdout: '\n' } },
    ])
    expect((await probeWorkspaceGit(exec, REPO))?.branch).toBeNull()
  })

  it('answers undefined outside any git repository', async () => {
    const exec = scripted([
      { args: ['rev-parse', '--show-toplevel'], out: { code: 128, stderr: 'fatal: not a git repository\n' } },
    ])
    expect(await probeWorkspaceGit(exec, '/plain')).toBeUndefined()
  })

  it('answers undefined when the common dir cannot be resolved', async () => {
    const exec = scripted([
      { args: ['rev-parse', '--show-toplevel'], out: { stdout: `${slashes(REPO)}\n` } },
      { args: ['rev-parse', '--git-common-dir'], out: { code: 128, stderr: 'fatal: bad revision\n' } },
    ])
    expect(await probeWorkspaceGit(exec, REPO)).toBeUndefined()
  })
})

describe('inspectWorktree', () => {
  it('counts porcelain rows as dirty files and reads the ahead count', async () => {
    const exec = scripted([
      { args: ['status', '--porcelain'], out: { stdout: ' M a.ts\n?? b.ts\nM  c.ts\n' } },
      { args: ['rev-list', '--count', '@{u}..HEAD'], out: { stdout: '2\n' } },
    ])
    expect(await inspectWorktree(exec, '/wt')).toEqual({ dirty: 3, ahead: 2 })
  })

  it('reports no upstream as undefined ahead, not an error', async () => {
    const exec = scripted([
      { args: ['status', '--porcelain'], out: { stdout: '' } },
      { args: ['rev-list', '--count', '@{u}..HEAD'], out: { code: 128, stderr: "fatal: no upstream configured for branch 'dev'\n" } },
    ])
    expect(await inspectWorktree(exec, '/wt')).toEqual({ dirty: 0, ahead: undefined })
  })
})

describe('removeWorktree', () => {
  it('removes a live linked worktree, --force only when asked', async () => {
    const plain = scripted([
      { args: ['worktree', 'list', '--porcelain'], out: { stdout: TWO_WORKTREES } },
      { args: ['worktree', 'remove', p('/root/repo/feat-x')] },
    ])
    expect(await removeWorktree(plain, '/repo', '/root/repo/feat-x', false, () => true))
      .toEqual({ path: p('/root/repo/feat-x'), pruned: false })

    const forced = scripted([
      { args: ['worktree', 'list', '--porcelain'], out: { stdout: TWO_WORKTREES } },
      { args: ['worktree', 'remove', '--force', p('/root/repo/feat-x')] },
    ])
    expect(await removeWorktree(forced, '/repo', '/root/repo/feat-x', true, () => true))
      .toEqual({ path: p('/root/repo/feat-x'), pruned: false })
  })

  it('prunes a stale registration instead of spawning remove', async () => {
    const exec = scripted([
      { args: ['worktree', 'list', '--porcelain'], out: { stdout: TWO_WORKTREES } },
      { args: ['worktree', 'prune'] },
    ])
    expect(await removeWorktree(exec, '/repo', '/root/repo/feat-x', false, () => false))
      .toEqual({ path: p('/root/repo/feat-x'), pruned: true })
  })

  it('refuses the main worktree and unregistered paths', async () => {
    const main = scripted([
      { args: ['worktree', 'list', '--porcelain'], out: { stdout: TWO_WORKTREES } },
    ])
    await expect(removeWorktree(main, '/repo', '/repo', false, () => true))
      .rejects.toThrow('cannot remove the main worktree')

    const unknown = scripted([
      { args: ['worktree', 'list', '--porcelain'], out: { stdout: TWO_WORKTREES } },
    ])
    await expect(removeWorktree(unknown, '/repo', '/elsewhere', false, () => true))
      .rejects.toThrow('is not a registered worktree')
  })

  it('surfaces a git refusal of the removal verbatim', async () => {
    const exec = scripted([
      { args: ['worktree', 'list', '--porcelain'], out: { stdout: TWO_WORKTREES } },
      { args: ['worktree', 'remove', p('/root/repo/feat-x')],
        out: { code: 128, stderr: 'fatal: unable to remove: file(s) locked\n' } },
    ])
    await expect(removeWorktree(exec, '/repo', '/root/repo/feat-x', false, () => true))
      .rejects.toThrow('locked')
  })
})
