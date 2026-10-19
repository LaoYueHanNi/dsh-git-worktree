/**
 * Turn a failed fetch into the plain sentence the toast should show.
 *
 * Git reports a broken remote in its own words: `fatal: 'C:\repo' does not
 * appear to be a git repository`. That sentence names a path and says nothing
 * about what to do with it, and it does not even say WHICH remote failed —
 * `git fetch --all` walks the remotes in order and stops naming them.
 *
 * The plugin knows more than that sentence does: the live fetch walks the
 * remotes one by one, so it knows which one failed and what address it points
 * at. This module recognises the common shapes and hands the toast the facts
 * it needs to name the next step.
 *
 * The route still returns git's text. This only decides whether the toast
 * replaces that text with a sentence of its own.
 *
 * @module git-worktree/client/fetch-error
 */

/**
 * - `remotePathMissing` the address points at a local folder that is gone or
 *                            is not a Git repository — the usual case of a
 *                            repository that was MOVED while its remote still
 *                            names the old path;
 * - `remoteNotFound`    the address names a repository that does not exist;
 * - `remoteAuthFailed`  the remote refused the connection (no key, no access);
 * - `remoteUnreachable` the host or the network could not be reached;
 * - `remoteUnknown`     the remote could not be read, for no reason git named.
 */
export type FetchFailureKind = 'remotePathMissing' | 'remoteNotFound' | 'remoteAuthFailed' | 'remoteUnreachable' | 'remoteUnknown'

/** What the toast needs to name a broken remote. */
export interface FetchFailure {
  kind: FetchFailureKind
  /** The remote's name, when the failure named one. */
  remote: string | null
  /** The address that remote points at, when known. */
  url: string | null
  /** The local folder a path-style address points at. */
  path: string | null
}

/**
 * The head the live fetch puts in front of git's own words: which remote
 * failed and what address it points at. A plain `git fetch --all` cannot say
 * this, so the head may be missing — the facts git printed still can.
 */
const REMOTE_HEAD = /^remote "([^"]+)" \(url: (.*)\)\s*$/m

/** The address git quotes back when the address itself is the problem. */
const QUOTED = /'([^']+)'/

/**
 * Recognise a fetch failure.
 * @param raw - the error text the route returned.
 * @returns the failure the toast should describe, or null when git's own
 * words are the best thing the user can read.
 */
export function explainFetchFailure(raw: string): FetchFailure | null {
  const text = stripCommand(raw)
  const head = REMOTE_HEAD.exec(text)
  const remote = head?.[1] ?? null
  const url = head?.[2]?.trim() || null
  const kind = classify(text)
  if (kind === null) return null
  // A failure that needs the address but did not get one is said in the
  // plainer words — a sentence with an empty address in it helps nobody.
  if (kind === 'remoteNotFound' || kind === 'remoteUnreachable') {
    if (url === null) return { kind: 'remoteUnknown', remote, url, path: null }
  }
  return {
    kind,
    remote,
    url,
    // The path git quoted back IS the folder the address points at.
    path: kind === 'remotePathMissing' ? (QUOTED.exec(text)?.[1] ?? url) : null,
  }
}

/**
 * The cause of a fetch failure, most specific first: git's closing sentence
 * ("Could not read from remote repository") follows every remote failure, so
 * it can only be the last resort.
 * @param text - the failure text without the command preamble.
 * @returns the cause, or null when nothing matches.
 */
function classify(text: string): FetchFailureKind | null {
  // A local address: git can only say this about a folder on disk.
  if (/does not appear to be a git repository/i.test(text)) return 'remotePathMissing'
  if (/permission denied \(publickey\)|too many authentication failures|authentication failed|could not read from remote repository\. please make sure you have the correct access rights/i.test(text)) return 'remoteAuthFailed'
  if (/repository not found|not found\.\s*$/im.test(text)) return 'remoteNotFound'
  if (/could not resolve hostname|name or service not known|connection (?:timed out|refused|reset)|network is unreachable|failed to connect|temporary failure in name resolution/i.test(text)) return 'remoteUnreachable'
  if (/could not read from remote repository/i.test(text)) return 'remoteUnknown'
  return null
}

/**
 * Drop the `git <args> failed (exit N):` preamble the route wraps errors in.
 * @param raw - the error text the route returned.
 * @returns the text git itself printed.
 */
function stripCommand(raw: string): string {
  return /^git [\s\S]*?failed \(exit \d+\):\s*([\s\S]*)$/.exec(raw)?.[1] ?? raw
}
