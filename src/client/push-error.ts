/**
 * Turn raw `git push --porcelain` / transport output into a cause the push
 * window can explain in the user's language.
 *
 * Git's own text stays beneath the explanation only where it carries more
 * than the sentence does (the remote's wording, e.g. a branch-protection
 * message; see {@link showsGitOutput}), but a bare
 * `!\trefs/heads/x:refs/heads/x\t[rejected] (fetch first)` tells most people
 * nothing about what to do next. Pure so the matching is testable without a
 * renderer (the vitest setup renders nothing, see branch-tree.ts).
 *
 * @module git-worktree/client/push-error
 */

/**
 * - `behind`   the remote branch has commits the local one lacks
 *              (`non-fast-forward` / `fetch first`);
 * - `stale`    a force-with-lease saw the remote change after the preview;
 * - `hook`    a local pre-push hook refused before the remote moved anything;
 * - `refused`  the remote accepted the connection but rejected the update
 *              (protected branch, server-side hook);
 * - `auth`     credentials or host trust failed before any update.
 */
export type PushFailureKind = 'behind' | 'stale' | 'hook' | 'refused' | 'auth'

/** Ordered: the most specific cause wins when several markers appear. */
const MARKERS: readonly (readonly [PushFailureKind, RegExp])[] = [
  ['stale', /\(stale info\)/i],
  ['hook', /\bpre-push hook\b/i],
  ['refused', /\[remote rejected\]|remote: error: |pre-receive hook declined|protected branch/i],
  ['behind', /\((?:non-fast-forward|fetch first)\)|\bnon-fast-forward\b|\bfetch first\b|tip of your current branch is behind/i],
  ['auth', /authentication failed|could not read (?:username|password)|terminal prompts disabled|permission denied \(publickey|host key verification failed|access denied|invalid credentials/i],
]

/** git's trailer on a rejected push. It names no rule and no hook. */
const PUSH_TRAILER = /^error: failed to push some refs\b/i

/**
 * What git itself said, without the `git <args…> failed (exit N): ` preamble.
 *
 * The push command line (`-c remote.x.mirror=false push --porcelain …`) is
 * long and pushes the remote's own wording (the one line that names a
 * protected branch or a failing hook) out of a short scrolling box. The
 * trailer `error: failed to push some refs to '<url>'` is dropped once any
 * other line says why; a failure that is only that trailer keeps it.
 * @param raw - the error text returned by the push route.
 * @returns git's output, or `raw` unchanged when it is not a git failure.
 */
export function gitOutput(raw: string): string {
  const output = /^git [\s\S]*?failed \(exit \d+\):\s*([\s\S]*)$/.exec(raw)?.[1]
  const text = output === undefined || output === '' ? raw : output
  const lines = text.split(/\r?\n/)
  const kept = lines.filter(line => !PUSH_TRAILER.test(line.trim()))
  if (kept.length === lines.length || kept.every(line => line.trim() === '')) return text
  return kept.join('\n').replace(/^\n+|\n+$/g, '')
}

/**
 * Whether git's own text is worth showing beneath the explanation.
 *
 * `behind` and `stale` are fully explained by one sentence that also names the
 * next step; git's side of it is only `hint: … git pull …` boilerplate. A
 * refusal or credential failure is different: the remote's wording names the
 * rule, hook or host that said no, which no fixed sentence can.
 * @param kind - a recognised cause.
 * @returns true when the text adds information.
 */
export function showsGitOutput(kind: PushFailureKind): boolean {
  return kind !== 'behind' && kind !== 'stale'
}

/**
 * Classify a push failure.
 * @param raw - the error text returned by the push route.
 * @returns the recognised cause, or null for anything else (shown verbatim).
 */
export function classifyPushFailure(raw: string): PushFailureKind | null {
  for (const [kind, pattern] of MARKERS) if (pattern.test(raw)) return kind
  return null
}
