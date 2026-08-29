import { describe, expect, it } from 'vitest'
import { normalize } from 'node:path'
import {
  addWorktree, addWorktreeCutout, cutoutBranchName, probeRepo, switchBranch,
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
      { args: ['for-each-ref', 'refs/heads'], out: { stdout: 'main\nfeat-x\n' } },
      { args: ['for-each-ref', 'refs/remotes'], out: { stdout: 'origin/HEAD\norigin/main\norigin/dev\nupstream/dev\n' } },
      { args: ['worktree', 'list', '--porcelain'], out: { stdout: TWO_WORKTREES } },
    ])
    const facts = await probeRepo(exec, '/repo/sub', () => true)
    expect(facts).toBeDefined()
    expect(facts?.repoName).toBe('repo')
    expect(facts?.currentBranch).toBe('main')
    expect(facts?.branches).toEqual([
      { name: 'main', kind: 'local' },
      { name: 'feat-x', kind: 'local' },
      { name: 'origin/dev', kind: 'remote' },
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
