import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CancelledError, childProcessExec, probeRepo, type Exec } from '../src/git.ts'
import { planPush, previewPush, pushBranch } from '../src/push.ts'
import { createProgressReader, type GitProgress } from '../src/progress.ts'

const cleanup: string[] = []
afterEach(async () => {
  for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-push-test-'))
  cleanup.push(directory)
  const local = join(directory, 'local')
  const remote = join(directory, 'remote.git')
  await mkdir(local)
  const exec: Exec = (file, args, options) => childProcessExec(file, ['-c', `core.hooksPath=${join(directory, 'no-hooks')}`, '-c', 'commit.gpgsign=false', ...args], options)
  const git = async (cwd: string, args: string[]) => {
    const result = await exec('git', args, { cwd })
    if (result.code !== 0) throw new Error(result.stderr)
    return result.stdout.trim()
  }
  await git(directory, ['init', '--bare', remote])
  await git(local, ['init', '-b', 'main'])
  await git(local, ['config', 'user.name', 'Test'])
  await git(local, ['config', 'user.email', 'test@example.invalid'])
  await git(local, ['commit', '--allow-empty', '-m', 'initial'])
  await git(local, ['remote', 'add', 'origin', remote])
  await git(local, ['push', '-u', 'origin', 'main'])
  return { directory, local, remote, exec, git }
}

describe('push with real local Git repositories', () => {
  it('previews local tracking refs offline without contacting a remote or accepting prefix descendants', async () => {
    const { directory, local, exec, git } = await fixture()
    const base = await git(local, ['rev-parse', 'HEAD'])
    await git(local, ['update-ref', 'refs/remotes/origin/review/nested', base])
    await git(local, ['commit', '--allow-empty', '-m', 'local subject', '-m', 'hidden body'])
    await git(local, ['remote', 'set-url', 'origin', join(directory, 'offline.git')])
    const offline: Exec = (file, args, options) => {
      if (['ls-remote', 'fetch', 'push'].includes(args[0]!)) throw new Error('local preview must not use the network')
      return exec(file, args, options)
    }
    const body = { repoPath: local, branch: 'main', remote: 'origin', target: 'main', localOnly: true }
    expect(await previewPush(offline, local, body)).toMatchObject({ targetOid: base, total: 1, commits: [{ subject: 'local subject' }] })
    expect(await previewPush(offline, local, { ...body, target: 'review' })).toMatchObject({ targetOid: null, total: 1 })
    expect(await git(local, ['rev-parse', 'origin/main'])).toBe(base)
    expect(await git(local, ['branch', '--show-current'])).toBe('main')
  }, 30_000)

  it('previews first-line commits for the selected target and permits an empty new branch', async () => {
    const { local, remote, exec, git } = await fixture()
    await git(local, ['switch', '-c', 'feature/x'])
    const body = { repoPath: local, branch: 'feature/x', remote: 'origin', target: 'feature/x' }
    expect(await previewPush(exec, local, body)).toMatchObject({ targetOid: null, total: 0, commits: [] })
    await git(local, ['commit', '--allow-empty', '-m', 'first subject', '-m', 'hidden body'])
    await git(local, ['commit', '--allow-empty', '-m', 'second subject'])
    const preview = await previewPush(exec, local, body)
    expect(preview.total).toBe(2)
    expect(preview.commits.map(commit => commit.subject)).toEqual(['second subject', 'first subject'])
    expect(await git(remote, ['for-each-ref', 'refs/heads/feature/x', '--format=%(refname)'])).toBe('')
    await pushBranch(exec, local, { ...body, sourceOid: preview.sourceOid })
    expect(await previewPush(exec, local, body)).toMatchObject({ targetOid: preview.sourceOid, total: 0 })
    expect((await previewPush(exec, local, { ...body, target: 'main' })).total).toBe(2)
    await git(local, ['commit', '--allow-empty', '-m', 'new after preview'])
    await expect(pushBranch(exec, local, { ...body, sourceOid: preview.sourceOid })).rejects.toThrow('local branch changed')
  }, 30_000)

  it('uses the configured push URL for preview instead of the fetch URL', async () => {
    const { directory, local, exec, git } = await fixture()
    const other = join(directory, 'push-target.git')
    await git(directory, ['init', '--bare', other])
    await git(local, ['remote', 'set-url', '--push', 'origin', other])
    expect(await previewPush(exec, local, { repoPath: local, branch: 'main', remote: 'origin', target: 'main', localOnly: true })).toMatchObject({ targetOid: expect.any(String) })
    expect(await previewPush(exec, local, { repoPath: local, branch: 'main', remote: 'origin', target: 'main' })).toMatchObject({ targetOid: null })
    await git(local, ['remote', 'set-url', '--add', '--push', 'origin', other + '-another'])
    await expect(previewPush(exec, local, { repoPath: local, branch: 'main', remote: 'origin', target: 'main' })).rejects.toThrow('exactly one push URL')
  }, 30_000)

  it('fetches missing preview objects without moving refs, rejects stale force leases, then forces only the selected branch', async () => {
    const { directory, local, remote, exec, git } = await fixture()
    await git(local, ['switch', '-c', 'feature/x'])
    await git(local, ['commit', '--allow-empty', '-m', 'local'])
    await pushBranch(exec, local, { repoPath: local, branch: 'feature/x', remote: 'origin', target: 'feature/x' })
    const source = await git(local, ['rev-parse', 'feature/x'])
    const peer = join(directory, 'peer')
    await git(directory, ['clone', '-b', 'feature/x', remote, peer])
    await git(peer, ['config', 'user.name', 'Peer'])
    await git(peer, ['config', 'user.email', 'peer@example.invalid'])
    await git(peer, ['commit', '--allow-empty', '-m', 'peer commit'])
    await git(peer, ['push'])
    const peerOid = await git(peer, ['rev-parse', 'HEAD'])
    const body = { repoPath: local, branch: 'feature/x', remote: 'origin', target: 'feature/x' }
    const preview = await previewPush(exec, local, body)
    expect(preview.targetOid).toBe(peerOid)
    expect(await git(local, ['rev-parse', 'origin/feature/x'])).toBe(source)
    expect(await git(local, ['rev-parse', 'HEAD'])).toBe(source)
    await git(peer, ['commit', '--allow-empty', '-m', 'concurrent update'])
    await git(peer, ['push'])
    const concurrent = await git(peer, ['rev-parse', 'HEAD'])
    await expect(pushBranch(exec, local, { ...body, force: true, expectedTarget: peerOid, sourceOid: source })).rejects.toThrow(/stale|rejected/)
    expect(await git(remote, ['rev-parse', 'feature/x'])).toBe(concurrent)
    const refreshed = await previewPush(exec, local, body)
    await pushBranch(exec, local, { ...body, force: true, expectedTarget: refreshed.targetOid!, sourceOid: refreshed.sourceOid })
    expect(await git(remote, ['rev-parse', 'feature/x'])).toBe(source)
    expect(await git(remote, ['rev-parse', 'main'])).not.toBe(source)
  }, 30_000)

  it('pushes no tags by default, only reachable annotated tags in follow mode, and all tags in all mode', async () => {
    const { local, remote, exec, git } = await fixture()
    await git(local, ['tag', '-a', 'annotated', '-m', 'annotation'])
    await git(local, ['tag', 'lightweight'])
    const tree = await git(local, ['rev-parse', 'HEAD^{tree}'])
    const unrelated = await git(local, ['commit-tree', tree, '-m', 'unrelated history'])
    await git(local, ['tag', '-a', 'unrelated', unrelated, '-m', 'other'])
    await git(local, ['config', 'push.followTags', 'true'])
    const body = { repoPath: local, branch: 'main', remote: 'origin', target: 'main' }
    await pushBranch(exec, local, body)
    expect(await git(remote, ['tag'])).toBe('')
    await pushBranch(exec, local, { ...body, tags: 'follow' })
    expect(await git(remote, ['tag'])).toBe('annotated')
    await pushBranch(exec, local, { ...body, tags: 'all' })
    expect(await git(remote, ['tag'])).toBe('annotated\nlightweight\nunrelated')
  }, 30_000)

  it('publishes a branch held by another worktree, preserves dirty files and sets upstream', async () => {
    const { directory, local, remote, exec, git } = await fixture()
    const linked = join(directory, 'linked')
    await git(local, ['worktree', 'add', '-b', 'feature/x', linked])
    await git(linked, ['commit', '--allow-empty', '-m', 'feature'])
    await writeFile(join(linked, 'draft.txt'), 'uncommitted')
    await git(local, ['branch', 'must-stay-local'])
    await git(local, ['tag', '-a', 'must-stay-local-tag', '-m', 'tag'])
    await git(local, ['config', 'remote.origin.mirror', 'true'])
    await git(local, ['config', 'remote.origin.push', '+refs/heads/*:refs/heads/*'])
    await git(local, ['config', 'push.followTags', 'true'])
    expect(await planPush(exec, local, 'feature/x')).toMatchObject({ confirm: true, target: 'feature/x' })
    await pushBranch(exec, local, { repoPath: local, branch: 'feature/x', remote: 'origin', target: 'feature/x' })
    expect(await git(remote, ['rev-parse', 'refs/heads/feature/x'])).toBe(await git(linked, ['rev-parse', 'HEAD']))
    expect(await git(local, ['branch', '--show-current'])).toBe('main')
    expect(await git(remote, ['for-each-ref', 'refs/heads/must-stay-local', 'refs/tags', '--format=%(refname)'])).toBe('')
    expect(await git(linked, ['status', '--porcelain'])).toBe('?? draft.txt')
    const branch = (await probeRepo(exec, linked))?.branches.find(branch => branch.name === 'feature/x')
    expect(branch).toEqual({ name: 'feature/x', kind: 'local', upstream: 'origin/feature/x' })
    expect((await planPush(exec, linked, 'feature/x')).confirm).toBe(false)
    await git(linked, ['commit', '--allow-empty', '-m', 'more'])
    expect((await probeRepo(exec, linked))?.branches.find(branch => branch.name === 'feature/x')?.ahead).toBe(1)
    await pushBranch(exec, linked, { repoPath: linked, branch: 'feature/x' })
    expect(await git(remote, ['rev-parse', 'refs/heads/feature/x'])).toBe(await git(linked, ['rev-parse', 'HEAD']))
  }, 30_000)

  it('reads a mixed-case branch push remote from real config and leaves a fork-style upstream untouched', async () => {
    const { directory, local, exec, git } = await fixture()
    const fork = join(directory, 'fork.git')
    await git(directory, ['init', '--bare', fork])
    await git(local, ['remote', 'add', 'fork', fork])
    await git(local, ['switch', '-c', 'Feature/X'])
    await git(local, ['commit', '--allow-empty', '-m', 'feature'])
    await pushBranch(exec, local, { repoPath: local, branch: 'Feature/X', remote: 'origin', target: 'Feature/X' })
    expect(await git(local, ['config', 'branch.Feature/X.remote'])).toBe('origin')
    // git prints this key as "branch.Feature/X.pushremote": section and variable lowercased, branch as written.
    await git(local, ['config', 'remote.pushDefault', 'origin'])
    await git(local, ['config', 'branch.Feature/X.pushRemote', 'fork'])
    expect(await planPush(exec, local, 'Feature/X')).toMatchObject({ remote: 'fork', confirm: true })
    await pushBranch(exec, local, { repoPath: local, branch: 'Feature/X', remote: 'fork', target: 'Feature/X' })
    expect(await git(fork, ['rev-parse', 'refs/heads/Feature/X'])).toBe(await git(local, ['rev-parse', 'Feature/X']))
    // The branch keeps tracking its same-named counterpart on origin.
    expect(await git(local, ['config', 'branch.Feature/X.remote'])).toBe('origin')
  }, 30_000)

  it('confirms inherited origin/main, refuses divergence, and recognizes a gone upstream', async () => {
    const { local, remote, exec, git } = await fixture()
    await git(local, ['-c', 'branch.autoSetupMerge=true', 'branch', 'feature/x', 'origin/main'])
    expect(await planPush(exec, local, 'feature/x')).toMatchObject({ confirm: true, target: 'feature/x', upstream: 'origin/main' })
    await pushBranch(exec, local, { repoPath: local, branch: 'feature/x', remote: 'origin', target: 'feature/x' })
    // Publishing replaced the upstream inherited from origin/main.
    expect(await git(local, ['rev-parse', '--abbrev-ref', 'feature/x@{upstream}'])).toBe('origin/feature/x')
    const initial = await git(local, ['rev-parse', 'feature/x'])
    // Advance the local branch without publishing, then move the bare remote
    // to a distinct commit from main. Neither side may overwrite the other.
    await git(local, ['switch', 'feature/x'])
    await git(local, ['commit', '--allow-empty', '-m', 'local'])
    await git(local, ['switch', 'main'])
    await git(local, ['commit', '--allow-empty', '-m', 'remote'])
    await git(local, ['push', 'origin', 'main:feature/x'])
    const remoteHead = await git(remote, ['rev-parse', 'feature/x'])
    expect(remoteHead).not.toBe(initial)
    await expect(pushBranch(exec, local, { repoPath: local, branch: 'feature/x' })).rejects.toThrow(/rejected|non-fast-forward/)
    expect(await git(remote, ['rev-parse', 'feature/x'])).toBe(remoteHead)
    await git(remote, ['update-ref', '-d', 'refs/heads/feature/x'])
    await git(local, ['fetch', '--prune'])
    const facts = await probeRepo(exec, local)
    expect(facts?.branches.find(branch => branch.name === 'feature/x')).toMatchObject({ upstream: 'origin/feature/x', upstreamGone: true })
    expect(facts?.toplevel).toBe(normalize(local))
    expect((await planPush(exec, local, 'feature/x')).confirm).toBe(true)
  }, 30_000)

  describe('as a live run', () => {
    /** A branch of `feature/big` carrying enough incompressible files to be a transfer git reports on. */
    async function bigBranch() {
      const context = await fixture()
      await context.git(context.local, ['switch', '-c', 'feature/big'])
      for (let index = 0; index < 40; index++) await writeFile(join(context.local, `f${String(index)}.bin`), randomBytes(20_000))
      await context.git(context.local, ['add', '.'])
      await context.git(context.local, ['commit', '-m', 'big'])
      return context
    }

    it('streams git’s own counters to the progress reader and lands the commits', async () => {
      const { local, remote, exec, git } = await bigBranch()
      const events: GitProgress[] = []
      const reader = createProgressReader(event => { events.push(event) }, { intervalMs: 0 })
      const output: string[] = []
      const result = await pushBranch(exec, local, { repoPath: local, branch: 'feature/big', remote: 'origin', target: 'feature/big' },
        { onOutput: (chunk) => { output.push(chunk); reader.feed(chunk) } })
      reader.end()
      expect(result).toEqual({ branch: 'feature/big', remote: 'origin', target: 'feature/big' })
      expect(await git(remote, ['rev-parse', 'refs/heads/feature/big'])).toBe(await git(local, ['rev-parse', 'feature/big']))
      // The counters, as the card would show them — and nothing but counters:
      // the porcelain ref line that shares the stream is not progress.
      expect(events.length).toBeGreaterThan(0)
      expect(events.some(event => event.text.startsWith('Writing objects') && event.percent === 100)).toBe(true)
      expect(events.every(event => /^[A-Za-z][A-Za-z ]*:\s+\d+%/.test(event.text))).toBe(true)
      expect(output.join('')).toContain('refs/heads/feature/big')
    }, 30_000)

    it('fails with the remote’s own reason and no counter redraws, leaving the remote branch where it was', async () => {
      const { local, remote, exec, git } = await bigBranch()
      // Someone else's commit on the same branch name: ours no longer fast-forwards it.
      await git(local, ['switch', 'main'])
      await git(local, ['commit', '--allow-empty', '-m', 'theirs'])
      await git(local, ['push', 'origin', 'main:feature/big'])
      const remoteHead = await git(remote, ['rev-parse', 'feature/big'])
      const failure = await pushBranch(exec, local, { repoPath: local, branch: 'feature/big', remote: 'origin', target: 'feature/big' }, {})
        .then(() => undefined, (error: unknown) => error as Error)
      expect(failure?.message).toMatch(/rejected|non-fast-forward/)
      expect(failure?.message).not.toMatch(/(?:Counting|Compressing|Writing) objects:\s+\d+%/)
      expect(await git(remote, ['rev-parse', 'feature/big'])).toBe(remoteHead)
    }, 30_000)

    it('stops a push the caller cancels, killing git so the remote never takes the branch', async () => {
      const { directory, local, remote, exec, git } = await bigBranch()
      // A pre-push hook that never finishes stands in for a transfer that is
      // still going when the user presses cancel; the hook dir is the empty one the fixture points at.
      const hooks = join(directory, 'no-hooks')
      await mkdir(hooks)
      await writeFile(join(hooks, 'pre-push'), '#!/bin/sh\nsleep 30\n', { mode: 0o755 })
      const controller = new AbortController()
      const started = Date.now()
      const pushing = pushBranch(exec, local, { repoPath: local, branch: 'feature/big', remote: 'origin', target: 'feature/big' }, { signal: controller.signal })
      setTimeout(() => { controller.abort() }, 800)
      await expect(pushing).rejects.toBeInstanceOf(CancelledError)
      expect(Date.now() - started).toBeLessThan(15_000)
      expect(await git(remote, ['for-each-ref', 'refs/heads/feature/big'])).toBe('')
    }, 30_000)
  })
})
