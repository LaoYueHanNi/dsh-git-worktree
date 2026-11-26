import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildCanonicalPrUrl,
  classifyRemotes,
  formatPrBaseLabel,
  formatPrBranchName,
  isForgeServiceLike,
  loadPrContext,
  parsePrInput,
  parseRemoteUrl,
  pickDefaultRemote,
  PrResolutionError,
  prRefSpec,
  resolvePrTarget,
  type ForgeServiceLike,
} from '../src/pr.ts'

describe('PR/MR parsing and remote classification', () => {
  it('parses HTTPS, SSH, SCP, and nested GitLab remote URLs', () => {
    expect(parseRemoteUrl('https://github.com/deepseek-ai/deepseek-harness.git')).toEqual({
      host: 'github.com',
      owner: 'deepseek-ai',
      repo: 'deepseek-harness',
      provider: 'github',
    })
    expect(parseRemoteUrl('git@gitlab.com:group/sub/my-app.git')).toEqual({
      host: 'gitlab.com',
      owner: 'group/sub',
      repo: 'my-app',
      provider: 'gitlab',
    })
    expect(parseRemoteUrl('ssh://git@git.company.internal/team/repo.git')).toEqual({
      host: 'git.company.internal',
      owner: 'team',
      repo: 'repo',
      provider: null,
    })
    expect(parseRemoteUrl('')).toBeUndefined()
  })

  it('parses numeric IDs and full GitHub/GitLab URLs with trailing tabs', () => {
    expect(parsePrInput('42')).toEqual({ kind: 'number', number: 42 })
    expect(parsePrInput('#42')).toEqual({ kind: 'number', number: 42 })
    expect(parsePrInput('!17')).toEqual({ kind: 'number', number: 17, hintProvider: 'gitlab' })
    expect(parsePrInput('https://github.com/octo/demo/pull/123/files?w=1#diff-1')).toEqual({
      kind: 'url',
      provider: 'github',
      host: 'github.com',
      owner: 'octo',
      repo: 'demo',
      number: 123,
      canonicalUrl: 'https://github.com/octo/demo/pull/123',
    })
    expect(parsePrInput('https://gitlab.internal.dev/group/sub/app/-/merge_requests/89/diffs')).toEqual({
      kind: 'url',
      provider: 'gitlab',
      host: 'gitlab.internal.dev',
      owner: 'group/sub',
      repo: 'app',
      number: 89,
      canonicalUrl: 'https://gitlab.internal.dev/group/sub/app/-/merge_requests/89',
    })
    expect(parsePrInput('not-a-pr')).toBeUndefined()
    expect(parsePrInput('0')).toBeUndefined()
  })

  it('builds prefixed branch names, base labels, and refspecs', () => {
    expect(formatPrBranchName('github', 42)).toBe('github-pr-42')
    expect(formatPrBranchName('gitlab', 42)).toBe('gitlab-mr-42')
    expect(formatPrBaseLabel('github', 42)).toBe('PR #42')
    expect(formatPrBaseLabel('github', 42, 'main')).toBe('PR #42 → main')
    expect(formatPrBaseLabel('gitlab', 17, 'develop')).toBe('MR !17 → develop')
    expect(prRefSpec('github', 42)).toBe('refs/pull/42/head')
    expect(prRefSpec('gitlab', 42)).toBe('refs/merge-requests/42/head')
  })

  it('prefers upstream over origin when picking default remote', () => {
    const remotes = classifyRemotes([
      { name: 'origin', url: 'https://github.com/fork/app.git' },
      { name: 'upstream', url: 'https://github.com/org/app.git' },
    ])
    expect(pickDefaultRemote(remotes)).toBe('upstream')
  })

  it('uses optional forge service for GHE / self-hosted GitLab and rejects mismatched URLs', () => {
    const fakeForge: ForgeServiceLike = {
      repositoryFromRemote: (url) => {
        if (url.includes('ghe.corp.local')) {
          return { forge: 'github', host: 'ghe.corp.local', owner: 'core', name: 'harness' }
        }
        return undefined
      },
      changeRequestFromUrl: (url) => {
        const m = /^https:\/\/ghe\.corp\.local\/core\/harness\/pull\/(\d+)/.exec(url)
        if (m === null) return undefined
        return {
          repository: { forge: 'github', host: 'ghe.corp.local', owner: 'core', name: 'harness' },
          number: Number(m[1]),
        }
      },
      changeRequestUrl: ref => `https://${ref.repository.host}/${ref.repository.owner}/${ref.repository.name}/pull/${ref.number}`,
      readiness: async () => ({ state: 'ready', message: null, signIn: null }),
      latest: () => ({
        snapshot: {
          url: 'https://ghe.corp.local/core/harness/pull/77',
          title: 'GHE feature',
          state: 'open',
          draft: false,
          author: 'alice',
          headBranch: 'feat/ghe',
          baseBranch: 'main',
        },
      }),
    }
    expect(isForgeServiceLike(fakeForge)).toBe(true)
    expect(isForgeServiceLike({})).toBe(false)

    const remotes = classifyRemotes([{ name: 'origin', url: 'git@ghe.corp.local:core/harness.git' }], fakeForge)
    const resolved = resolvePrTarget({
      repoRoot: '/repo',
      input: 'https://ghe.corp.local/core/harness/pull/77',
      remotes,
      worktrees: [{ path: '/repo', branch: 'main', main: true }],
      localBranches: ['main'],
      forge: fakeForge,
    })
    expect(resolved).toEqual({
      provider: 'github',
      number: 77,
      remote: 'origin',
      refSpec: 'refs/pull/77/head',
      localBranch: 'github-pr-77',
      targetPath: join('/repo', '.dsh', 'gitworktree', 'github-pr-77'),
      canonicalUrl: 'https://ghe.corp.local/core/harness/pull/77',
      meta: {
        title: 'GHE feature',
        author: 'alice',
        state: 'open',
        draft: false,
        headBranch: 'feat/ghe',
        baseBranch: 'main',
      },
    })

    expect(buildCanonicalPrUrl(remotes[0]!, 'github', 77, fakeForge)).toBe('https://ghe.corp.local/core/harness/pull/77')

    let mismatchError: unknown
    try {
      resolvePrTarget({
        repoRoot: '/repo',
        input: 'https://github.com/other/repo/pull/5',
        remotes,
        worktrees: [],
        localBranches: [],
        forge: fakeForge,
      })
    } catch (err) {
      mismatchError = err
    }
    expect(mismatchError).toBeInstanceOf(PrResolutionError)
    expect((mismatchError as PrResolutionError).code).toBe('url_repo_mismatch')
    expect((mismatchError as PrResolutionError).params).toEqual({ owner: 'other', repo: 'repo', host: 'github.com' })
  })

  it('flags occupiedByMain when the main checkout currently holds the PR branch', () => {
    const remotes = classifyRemotes([{ name: 'origin', url: 'https://github.com/org/app.git' }])
    const resolved = resolvePrTarget({
      repoRoot: '/repo',
      input: '42',
      remotes,
      worktrees: [{ path: '/repo', branch: 'github-pr-42', main: true }],
      localBranches: ['main', 'github-pr-42'],
    })
    expect(resolved.occupiedByMain).toBe(true)
    expect(resolved.existingWorktreePath).toBeUndefined()
  })

  it('scopes loadPrContext candidate queries to an explicitly requested remote', async () => {
    const queriedRepos: string[] = []
    const forge: ForgeServiceLike = {
      repositoryFromRemote: (url) => {
        if (url.includes('fork/app')) return { forge: 'github', host: 'github.com', owner: 'fork', name: 'app' }
        if (url.includes('org/app')) return { forge: 'github', host: 'github.com', owner: 'org', name: 'app' }
        return undefined
      },
      changeRequestFromUrl: () => undefined,
      changeRequestUrl: () => '',
      readiness: async () => ({ state: 'ready', message: null, signIn: null }),
      listForViewer: async (_forge, query) => {
        queriedRepos.push(`${query.repository?.owner}/${query.repository?.name}:${query.filter}`)
        return { viewer: 'me', total: 0, items: [] }
      },
    }
    const ctx = await loadPrContext({
      repoRoot: '/repo',
      repoName: 'app',
      rawRemotes: [
        { name: 'origin', url: 'https://github.com/fork/app.git' },
        { name: 'upstream', url: 'https://github.com/org/app.git' },
      ],
      worktrees: [{ path: '/repo', branch: 'main', main: true }],
      requestedRemote: 'origin',
      forge,
    })
    expect(ctx.defaultRemote).toBe('upstream')
    expect(queriedRepos.every(entry => entry.startsWith('fork/app:'))).toBe(true)
  })
})
