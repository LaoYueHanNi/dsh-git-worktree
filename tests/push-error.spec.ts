import { describe, expect, it } from 'vitest'
import { classifyPushFailure, gitOutput, showsGitOutput } from '../src/client/push-error.ts'

describe('classifyPushFailure', () => {
  // One row per alternative in MARKERS, so a pattern that stops matching shows up by name.
  it.each([
    ['behind', '! refs/heads/x:refs/heads/x\t[rejected] (non-fast-forward)'],
    ['behind', '! refs/heads/x:refs/heads/x\t[rejected] (fetch first)'],
    ['behind', 'hint: Updates were rejected because a pushed branch tip is behind its remote counterpart.\nhint: non-fast-forward'],
    ['behind', 'hint: Updates were rejected because the remote contains work that you do not have locally. fetch first'],
    ['behind', 'hint: Updates were rejected because the tip of your current branch is behind'],
    ['stale', '! refs/heads/x:refs/heads/x\t[rejected] (stale info)'],
    ['hook', 'dsh-test: pre-push hook refused refs/heads/dsh-test/deny'],
    ['hook', 'error: failed to push some refs to origin\npre-push hook declined'],
    ['refused', '! refs/heads/x:refs/heads/x\t[remote rejected] (pre-receive hook declined)'],
    ['refused', 'remote: error: GH006: Protected branch update failed for refs/heads/main.'],
    ['refused', 'remote: error: refusing to update checked out branch'],
    ['refused', 'error: pre-receive hook declined'],
    ['refused', 'GitLab: You are not allowed to push code to protected branches on this project. (protected branch)'],
    ['auth', "fatal: Authentication failed for 'https://example.com/x.git/'"],
    ['auth', 'fatal: could not read Username for https://example.com: terminal prompts disabled'],
    ['auth', 'fatal: could not read Password for https://example.com'],
    ['auth', 'git@example.com: Permission denied (publickey).'],
    ['auth', 'Host key verification failed.'],
    ['auth', 'remote: Access denied'],
    ['auth', 'remote: Invalid credentials'],
  ] as const)('recognises %s in %j', (kind, raw) => {
    expect(classifyPushFailure(raw)).toBe(kind)
  })

  it('lets the most specific cause win when several markers appear', () => {
    // A lease failure is also a rejection; the lease explanation is the useful one.
    expect(classifyPushFailure('! refs/heads/x:refs/heads/x\t[rejected] (stale info)\nhint: non-fast-forward')).toBe('stale')
    // A server-side refusal is not "pull first" even though git also prints the ref.
    expect(classifyPushFailure('! [remote rejected] x -> x (protected branch)\nerror: failed to push some refs (fetch first)')).toBe('refused')
  })

  it('returns null for anything it does not know, so the raw text is shown as is', () => {
    expect(classifyPushFailure('')).toBeNull()
    expect(classifyPushFailure('fatal: unable to access: Could not resolve host')).toBeNull()
  })
})

describe('showsGitOutput', () => {
  it('hides git text for causes the one-line explanation already covers', () => {
    expect(showsGitOutput('behind')).toBe(false)
    expect(showsGitOutput('stale')).toBe(false)
  })

  it('keeps it where the remote names the rule, hook or host that refused', () => {
    expect(showsGitOutput('hook')).toBe(true)
    expect(showsGitOutput('refused')).toBe(true)
    expect(showsGitOutput('auth')).toBe(true)
  })
})

describe('gitOutput', () => {
  const command = '-c remote.fork.mirror=false push --porcelain --no-force --no-mirror --no-follow-tags --recurse-submodules=no --set-upstream -- fork refs/heads/protected/demo:refs/heads/protected/demo'

  it('drops the command line and the generic trailer, keeping what the remote said', () => {
    const stderr = 'remote: error: GH006: Protected branch update failed for refs/heads/protected/demo.\nerror: failed to push some refs to \'https://example.com/x.git\''
    expect(gitOutput(`git ${command} failed (exit 1): ${stderr}`)).toBe('remote: error: GH006: Protected branch update failed for refs/heads/protected/demo.')
  })

  it('keeps the trailer when it is the only thing git said', () => {
    const stderr = 'error: failed to push some refs to \'https://example.com/x.git\''
    expect(gitOutput(`git ${command} failed (exit 1): ${stderr}`)).toBe(stderr)
  })

  it('leaves text that is not a git failure alone', () => {
    expect(gitOutput('Remote "fork" is not configured.')).toBe('Remote "fork" is not configured.')
    expect(gitOutput('')).toBe('')
  })

  it('keeps the whole text when git printed nothing after the preamble', () => {
    const raw = `git ${command} failed (exit 1): `
    expect(gitOutput(raw)).toBe(raw)
  })
})
