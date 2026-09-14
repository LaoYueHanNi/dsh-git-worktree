/**
 * Bounded-concurrency map for the browser half's fan-out calls.
 *
 * Every plugin route that answers a batch is a git process per item on the
 * host side, and on Windows a process spawn is the expensive part — the
 * `/group` route already caps its own fan-out for exactly this reason. The
 * browser side has the same duty for the calls it makes ONE PER ITEM
 * (the manager dialog inspects every scanned worktree): a bare
 * `Promise.all(items.map(...))` hands the host as many concurrent spawns as
 * the user happens to have directories.
 *
 * @module git-worktree/client/concurrency
 */

/**
 * Map over `items` with at most `limit` calls in flight, preserving INPUT
 * ORDER in the result (the caller zips results back onto its rows, so
 * completion order must not leak). Rejections propagate like `Promise.all`:
 * callers that want per-item tolerance catch inside `fn`.
 *
 * @param items - the inputs, mapped in order.
 * @param limit - maximum concurrent calls; values under 1 are clamped to 1.
 * @param fn - the per-item async work, given the item and its index.
 * @returns the results, index-aligned with `items`.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  // Pair each item with its index up front: the workers then pull whole
  // entries, so an `undefined` reads as "queue drained" and can never be
  // confused with an item whose own value is undefined.
  const queue = items.map((item, index) => [item, index] as const)
  const results: R[] = []
  const width = Math.max(1, Math.floor(limit))
  // A shared cursor beats slicing into fixed batches: a batch only advances
  // when its SLOWEST member lands, so one slow directory would idle the
  // rest of its batch. Workers pull the next entry the moment they are free.
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const entry = queue[cursor]
      cursor += 1
      if (entry === undefined) return
      const [item, index] = entry
      results[index] = await fn(item, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, queue.length) }, worker))
  return results
}
