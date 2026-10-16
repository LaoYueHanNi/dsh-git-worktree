/** Resolve and push explicit refs. Never infer the source from the executor's HEAD. */
import { CancelledError, GitError, liveExecOptions, type Exec, type LiveRun } from './git.js'
import { stripProgress } from './progress.js'
import type { PushBody, PushPlan, PushPreview, PushPreviewBody, PushResult } from './wire.js'

async function run(exec: Exec, cwd: string, args: readonly string[]): Promise<string> {
  const result = await exec('git', args, { cwd })
  if (result.code !== 0) throw new GitError(args, result.code, result.stderr)
  return result.stdout.trim()
}

/** Only the two keys that can name a push remote: one process instead of one per key. */
const PUSH_REMOTE_KEYS = '^(remote\\.pushdefault|branch\\..*\\.pushremote)$'

/** `branch.<name>.pushRemote`, else `remote.pushDefault`, else '' (neither configured). */
async function configuredPushRemote(exec: Exec, cwd: string, branch: string): Promise<string> {
  const args = ['config', '--get-regexp', PUSH_REMOTE_KEYS]
  const result = await exec('git', args, { cwd })
  if (result.code === 1) return '' // no match, not a failure
  if (result.code !== 0) throw new GitError(args, result.code, result.stderr)
  const wanted = `branch.${branch}.pushremote` // git lowercases section and variable, never the branch
  let pushDefault = ''
  let branchRemote = ''
  for (const line of result.stdout.split('\n')) {
    const space = line.indexOf(' ')
    if (space === -1) continue
    const key = line.slice(0, space)
    // Later entries win, as in git's own resolution.
    if (key === 'remote.pushdefault') pushDefault = line.slice(space + 1).trim()
    else if (key === wanted) branchRemote = line.slice(space + 1).trim()
  }
  return branchRemote || pushDefault
}

async function pushUrl(exec: Exec, cwd: string, remote: string): Promise<string> {
  const result = await exec('git', ['remote', 'get-url', '--push', '--all', '--', remote], { cwd })
  // Doubles as the "is this remote configured?" check, saving a `git remote` process.
  if (result.code !== 0) throw new Error(`Remote "${remote}" is not configured. ${result.stderr.trim()}`.trim())
  const urls = result.stdout.trim().split('\n').filter(Boolean)
  if (urls.length !== 1) throw new Error(`Remote "${remote}" needs exactly one push URL for a branch push preview.`)
  return urls[0]!
}

interface ResolvedPlan {
  plan: PushPlan
  /** Tip of the local branch, read together with its tracking facts. */
  sourceOid: string
  /** Publishing should point the branch's tracking at the pushed destination. */
  adoptUpstream: boolean
}

/**
 * Everything the plan needs comes from three independent reads (the exact
 * ref with its tracking facts, the remote list, the push-remote keys), run
 * together rather than one process after another.
 */
async function resolvePlan(exec: Exec, cwd: string, branch: string): Promise<ResolvedPlan> {
  const [refs, remoteList, configured] = await Promise.all([
    run(exec, cwd, ['for-each-ref', `refs/heads/${branch}`, '--format=%(refname)%09%(objectname)%09%(upstream:short)%09%(upstream:remotename)%09%(upstream:remoteref)%09%(upstream:track)']),
    run(exec, cwd, ['remote']),
    configuredPushRemote(exec, cwd, branch),
  ])
  const fields = refs.split('\n').map(line => line.split('\t')).find(parts => parts[0] === `refs/heads/${branch}`)
  if (fields === undefined) throw new Error(`Local branch "${branch}" no longer exists; refresh the branch list.`)
  const [, sourceOid = '', upstream = '', upstreamRemote = '', upstreamRef = '', track = ''] = fields
  const remotes = remoteList.split('\n').filter(Boolean)
  if (remotes.length === 0) throw new Error('No Git remote configured. Add a remote before pushing a branch.')
  const remote = configured || (remotes.includes(upstreamRemote) ? upstreamRemote : remotes.includes('origin') ? 'origin' : remotes[0]!)
  if (!remotes.includes(remote)) throw new Error(`Push remote "${remote}" is not configured; correct the Git push configuration.`)
  // A branch cut from origin/main may automatically track main. Publishing
  // it must suggest its OWN name, not silently send new feature commits to main.
  const gone = track === '[gone]'
  const sameNameCounterpart = upstream !== '' && !gone && upstreamRef === `refs/heads/${branch}`
  const confirm = upstream === '' || gone || remote !== upstreamRemote || upstreamRef !== `refs/heads/${branch}`
  return {
    plan: { branch, remotes, remote, target: branch, confirm, ...(upstream === '' ? {} : { upstream }) },
    sourceOid,
    // A same-named upstream is the branch's real counterpart, possibly on a
    // different remote than the one pushed to (a fork workflow). Only a
    // missing, vanished or inherited-base upstream is replaced.
    adoptUpstream: !sameNameCounterpart,
  }
}

export async function planPush(exec: Exec, cwd: string, branch: string): Promise<PushPlan> {
  return (await resolvePlan(exec, cwd, branch)).plan
}

/** Local tip of `refs/remotes/<remote>/<target>`, or null when it is not tracked. */
async function trackingOid(exec: Exec, cwd: string, remote: string, target: string): Promise<string | null> {
  const trackingRef = `refs/remotes/${remote}/${target}`
  const refs = await run(exec, cwd, ['for-each-ref', '--format=%(refname)%09%(objectname)', trackingRef])
  // for-each-ref can include prefix descendants. Only the exact target counts.
  return refs.split('\n').map(line => line.split('\t')).find(parts => parts[0] === trackingRef)?.[1] ?? null
}

type CommitList = Pick<PushPreview, 'commits' | 'total' | 'truncated'>

/** The commits `sourceOid` would add to the target, one subject line each. */
async function commitsToPush(exec: Exec, cwd: string, sourceOid: string, remote: string, targetOid: string | null): Promise<CommitList> {
  // A new branch excludes commits already known on this remote's other branches.
  const range = [sourceOid, ...(targetOid === null ? ['--not', `--remotes=${remote}`] : [`^${targetOid}`]), '--']
  // Most pushes fit in the visible payload. Read one extra subject to detect
  // truncation; avoid recounting history when the message list is complete.
  const log = await run(exec, cwd, ['log', '-n', '201', '--format=%H%x09%s', ...range])
  const all = log === '' ? [] : log.split('\n').map(line => {
    const tab = line.indexOf('\t')
    return { oid: line.slice(0, tab), subject: line.slice(tab + 1) }
  })
  const truncated = all.length > 200
  const commits = all.slice(0, 200)
  const total = truncated ? Number(await run(exec, cwd, ['rev-list', '--count', ...range])) : commits.length
  return { commits, total, truncated }
}

/**
 * Opening the push window: the default destination plus a display-only
 * snapshot of what it would push, computed from local refs. One request
 * replaces a plan call followed by a separate local preview, and the two
 * share their reads. The snapshot is a courtesy: a failure to build it
 * leaves the plan intact, and the verified preview reports real problems.
 */
export async function openPush(exec: Exec, cwd: string, branch: string): Promise<PushPlan> {
  const { plan, sourceOid } = await resolvePlan(exec, cwd, branch)
  try {
    const targetOid = await trackingOid(exec, cwd, plan.remote, plan.target)
    return { ...plan, local: { sourceOid, targetOid, ...await commitsToPush(exec, cwd, sourceOid, plan.remote, targetOid) } }
  } catch {
    return plan
  }
}

/** Local snapshots are display-only; the verified preview reads the actual push destination. */
export async function previewPush(exec: Exec, cwd: string, body: PushPreviewBody): Promise<PushPreview> {
  const targetRef = `refs/heads/${body.target}`
  // The reads below do not depend on one another. Run them as one stage so
  // Windows process startup does not serialize the preview.
  const checkTarget = run(exec, cwd, ['check-ref-format', targetRef])
  const readSource = run(exec, cwd, ['rev-parse', '--verify', `refs/heads/${body.branch}^{commit}`])
  if (body.localOnly === true) {
    const [, sourceOid, remotes, targetOid] = await Promise.all([
      checkTarget, readSource, run(exec, cwd, ['remote']), trackingOid(exec, cwd, body.remote, body.target),
    ])
    if (!remotes.split('\n').includes(body.remote)) throw new Error(`Remote "${body.remote}" is not configured.`)
    return { sourceOid, targetOid, ...await commitsToPush(exec, cwd, sourceOid, body.remote, targetOid) }
  }
  const [, sourceOid, url] = await Promise.all([checkTarget, readSource, pushUrl(exec, cwd, body.remote)])
  const read = await exec('git', ['ls-remote', '--heads', '--refs', '--', url, targetRef], { cwd, timeoutMs: 20_000, nonInteractive: true })
  if (read.code !== 0) throw new GitError(['ls-remote', body.remote, targetRef], read.code, read.stderr)
  const targetOid = read.stdout.trim().split('\n').map(line => line.split('\t')).find(parts => parts[1] === targetRef)?.[0] ?? null
  let list: CommitList
  try {
    list = await commitsToPush(exec, cwd, sourceOid, body.remote, targetOid)
  } catch (error) {
    // The common case needs no probe: the target tip is usually already
    // local. Only when the walk failed do we check for a missing object.
    if (targetOid === null) throw error
    if ((await exec('git', ['cat-file', '-e', `${targetOid}^{commit}`], { cwd })).code === 0) throw error
    // Empty refmap and no FETCH_HEAD avoid moving tracking refs during a preview.
    const args = ['fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--no-auto-maintenance', '--refmap=', '--', url, targetRef]
    const fetched = await exec('git', args, { cwd, timeoutMs: 120_000, nonInteractive: true })
    if (fetched.code !== 0) throw new GitError(['fetch', body.remote, targetRef], fetched.code, fetched.stderr)
    await run(exec, cwd, ['cat-file', '-e', `${targetOid}^{commit}`])
    list = await commitsToPush(exec, cwd, sourceOid, body.remote, targetOid)
  }
  return { sourceOid, targetOid, ...list }
}

/**
 * Push one explicit local branch to an explicit (or default) destination.
 * A plain call is one buffered `git push` under a two-minute cap; a
 * {@link LiveRun} lifts the cap (a big push has no honest upper bound) for
 * git's own progress, a cancel that kills the push, and five minutes of
 * silence — a hung connection or hook — as the only limit.
 * @param exec - executor seam.
 * @param cwd - repository directory.
 * @param body - what to push and where.
 * @param live - optional live output / cancellation of the push itself.
 * @returns the branch, remote and target that were pushed.
 */
export async function pushBranch(exec: Exec, cwd: string, body: PushBody, live?: LiveRun): Promise<PushResult> {
  const { plan, sourceOid: current, adoptUpstream } = await resolvePlan(exec, cwd, body.branch)
  const publishing = body.remote !== undefined && body.target !== undefined
  if (!publishing && plan.confirm) throw new Error('The push destination needs confirmation. Reopen Push to choose a remote and branch.')
  const remote = publishing ? body.remote! : plan.remote
  const target = publishing ? body.target! : plan.target
  if (!plan.remotes.includes(remote)) throw new Error(`Remote "${remote}" is not configured.`)
  await run(exec, cwd, ['check-ref-format', `refs/heads/${target}`])
  if (body.sourceOid !== undefined) {
    await pushUrl(exec, cwd, remote)
    if (current !== body.sourceOid) throw new Error('The local branch changed after preview. Refresh the push preview before retrying.')
  }
  if (body.force === true && (!publishing || body.sourceOid === undefined || body.expectedTarget === undefined
    || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})?$/.test(body.expectedTarget))) {
    throw new Error('Force push requires an explicit destination and its previewed revision. Refresh the push preview.')
  }
  // Git applies remote.<name>.mirror after parsing --no-mirror. Override it
  // for this invocation too; never edit the repository's persistent config.
  const args = ['-c', `remote.${remote}.mirror=false`, 'push', '--porcelain', '--no-force', '--no-mirror', '--no-follow-tags', '--recurse-submodules=no',
    // git draws its counters (`Writing objects: 45% …`) only on a terminal otherwise.
    ...(live === undefined ? [] : ['--progress']),
    ...(body.force === true ? [`--force-with-lease=refs/heads/${target}:${body.expectedTarget!}`] : []),
    ...(body.tags === 'all' ? ['--tags'] : body.tags === 'follow' ? ['--follow-tags'] : []),
    // Tracking follows the push only when the branch has no real counterpart
    // yet. A one-off push to another remote or name must not rewrite it.
    ...(publishing && adoptUpstream ? ['--set-upstream'] : []), '--', remote, `refs/heads/${body.branch}:refs/heads/${target}`]
  const result = live === undefined
    ? await exec('git', args, { cwd, timeoutMs: 120_000, nonInteractive: true })
    : await exec('git', args, { cwd, nonInteractive: true, ...liveExecOptions(live) })
  if (result.cancelled) throw new CancelledError()
  // A live run's stderr carries every counter redraw; the failure is what is left.
  if (result.code !== 0) throw new GitError(args, result.code, [live === undefined ? result.stderr : stripProgress(result.stderr), result.stdout].filter(Boolean).join('\n'))
  return { branch: body.branch, remote, target }
}
