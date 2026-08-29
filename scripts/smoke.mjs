/**
 * One-shot smoke: real git over the built lib — probe, addWorktree (local,
 * remote-twin, reuse, stale-prune), switch (live-occupancy refusal). Run
 * manually after M1 build changes.
 */
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { childProcessExec, addWorktree, addWorktreeCutout, cutoutBranchName, probeRepo, switchBranch } from '../lib/git.js'

const run = promisify(execFile)

const root = await mkdtemp(join(tmpdir(), 'dsh-gwt-smoke-'))
const repo = join(root, 'my-repo')
const store = join(root, 'store')
const fail = (label) => { console.log(`FAIL ${label}`); process.exitCode = 1 }
const ok = (label, condition) => { console.log(`${condition ? 'ok' : 'FAIL'} ${label}`); if (!condition) process.exitCode = 1 }

try {
  await mkdir(repo)
  await run('git', ['init', '-b', 'main'], { cwd: repo })
  await run('git', ['config', 'user.email', 'smoke@test'], { cwd: repo })
  await run('git', ['config', 'user.name', 'smoke'], { cwd: repo })
  await writeFile(join(repo, 'a.txt'), 'a\n')
  await run('git', ['add', '.'], { cwd: repo })
  await run('git', ['commit', '-m', 'init'], { cwd: repo })
  await run('git', ['branch', 'feat/x'], { cwd: repo })
  await run('git', ['branch', 'other'], { cwd: repo })
  await run('git', ['remote', 'add', 'origin', repo], { cwd: repo })
  await run('git', ['fetch', 'origin', `main:refs/remotes/origin/only-remote`], { cwd: repo }).catch(() => {})

  const facts = await probeRepo(childProcessExec, repo)
  ok('probe repoName', facts?.repoName === 'my-repo')
  ok('probe currentBranch', facts?.currentBranch === 'main')
  ok('probe branch kinds', JSON.stringify(facts?.branches) === JSON.stringify([
    { name: 'feat/x', kind: 'local' }, { name: 'main', kind: 'local' }, { name: 'only-remote', kind: 'local' }, { name: 'other', kind: 'local' },
  ]) || facts?.branches.some(b => b.name === 'origin/only-remote'))

  const local = await addWorktree(childProcessExec, repo, 'feat/x', join(store, 'my-repo', 'feat-x'))
  ok('add local created', local.created === true)
  await stat(join(store, 'my-repo', 'feat-x', 'a.txt')).then(
    () => ok('worktree file present', true),
    () => ok('worktree file present', false),
  )
  const again = await addWorktree(childProcessExec, repo, 'feat/x', join(store, 'my-repo', 'feat-x-2'))
  ok('add reuse idempotent', again.created === false && again.path === local.path)

  // Cutout: a new branch out of the occupied current branch.
  const cutName = await cutoutBranchName(childProcessExec, repo, 'main')
  ok('cutout name free', cutName === 'main-wt')
  await addWorktreeCutout(childProcessExec, repo, 'main', cutName, join(store, 'my-repo', cutName))
  await stat(join(store, 'my-repo', 'main-wt', 'a.txt')).then(
    () => ok('cutout worktree file present', true),
    () => ok('cutout worktree file present', false),
  )
  const cutName2 = await cutoutBranchName(childProcessExec, repo, 'main')
  ok('cutout name suffixes past taken', cutName2 === 'main-wt2')
  const cutFacts = await probeRepo(childProcessExec, repo)
  ok('cutout worktree visible', cutFacts?.worktrees.some(w => w.branch === 'main-wt'))

  const twin = await addWorktree(childProcessExec, repo, 'origin/only-remote', join(store, 'my-repo', 'only-remote'))
  ok('add twin created', twin.created === true)

  const refused = await switchBranch(childProcessExec, repo, 'feat/x').then(
    () => fail('switch onto occupied branch must refuse'),
    error => ok('switch refuses occupied branch', String(error).includes('already used by worktree')),
  )

  // Stale registration: remove the directory behind git's back. Probe drops
  // it, switch recovers via prune, and add recreates it afterwards.
  await rm(join(store, 'my-repo', 'feat-x'), { recursive: true, force: true })
  const staleFacts = await probeRepo(childProcessExec, repo)
  ok('probe drops stale worktree', staleFacts?.worktrees.every(w => w.path !== join(store, 'my-repo', 'feat-x')))
  const switched = await switchBranch(childProcessExec, repo, 'feat/x').then(
    name => ok('switch recovers after stale prune', name === 'feat/x'),
    error => { ok('switch recovers after stale prune', false); console.log(String(error)) },
  )
  const back = await switchBranch(childProcessExec, repo, 'main')
  ok('switch back to main', back === 'main')
  const recreated = await addWorktree(childProcessExec, repo, 'feat/x', join(store, 'my-repo', 'feat-x'))
  ok('add recovers after stale prune', recreated.created === true)
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => { /* best-effort */ })
}
console.log(process.exitCode === 1 ? 'SMOKE FAILED' : 'SMOKE PASSED')
