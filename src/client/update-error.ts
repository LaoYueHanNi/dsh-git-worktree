/**
 * Turn a failed `git merge --ff-only @{u}` into the next step the update
 * toast should name.
 *
 * The route still returns git's own text. What the toast must not do is
 * repeat it: a diverged branch arrives as a `hint:` essay (`git merge`,
 * `git rebase`, how to silence the advice) whose only fact is `fatal: Not
 * possible to fast-forward`. The sentence replaces that essay. Anything this
 * module does not recognise stays git's words, with the command preamble and
 * the `hint:` lines taken off.
 *
 * @module git-worktree/client/update-error
 */

/**
 * - `diverged`   both sides have commits the other lacks, so a fast-forward
 *                is impossible;
 * - `dirty`      uncommitted files would be overwritten by the fast-forward;
 * - `noUpstream` the branch has no upstream to fast-forward to.
 */
export type UpdateFailureKind = 'diverged' | 'dirty' | 'noUpstream'

/** Ordered: the most specific cause wins when several markers appear. */
const MARKERS: readonly (readonly [UpdateFailureKind, RegExp])[] = [
  ['diverged', /not possible to fast-forward|diverging branches can't be fast-forwarded/i],
  ['dirty', /would be overwritten by merge|please commit your changes or stash them before you merge/i],
  ['noUpstream', /no upstream configured|does not have (?:an |any )?upstream|no tracking information for the current branch/i],
]

/**
 * Classify an update failure.
 * @param raw - the error text returned by the update route.
 * @returns the recognised cause, or null when the toast should keep git's words.
 */
export function explainUpdateFailure(raw: string): UpdateFailureKind | null {
  for (const [kind, pattern] of MARKERS) if (pattern.test(raw)) return kind
  return null
}

/**
 * Git's own words for an update failure this toast does not name.
 *
 * Drops the `git <args> failed (exit N):` preamble and every `hint:` line.
 * A diverged update is nothing but those two, which is why a recognised
 * cause never calls this.
 * @param raw - the error text returned by the update route.
 * @returns the remaining text, or `raw` when stripping would leave nothing.
 */
export function updateErrorText(raw: string): string {
  const body = /^git [\s\S]*?failed \(exit \d+\):\s*([\s\S]*)$/.exec(raw)?.[1]
  const text = body === undefined || body === '' ? raw : body
  const kept = text.split(/\r?\n/).filter(line => {
    const trimmed = line.trim()
    return trimmed !== '' && !/^hint:/i.test(trimmed)
  })
  return kept.length === 0 ? text : kept.join('\n')
}
