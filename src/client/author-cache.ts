/** Author lists remembered in the page, keyed by repository path and tip.
 * A tip identifies one history. Branch updates, fetch, and an explicit reload
 * drop every list for that repository; a response that started earlier cannot
 * write itself back. */
const LIMIT = 32
const memory = new Map<string, readonly string[]>()
const epochs = new Map<string, number>()

const keyOf = (repoPath: string, tip: string): string => `${repoPath}\0${tip}`

export function authorEpoch(repoPath: string): number {
  return epochs.get(repoPath) ?? 0
}

export function cachedAuthors(repoPath: string, tip: string): readonly string[] | undefined {
  const key = keyOf(repoPath, tip)
  const hit = memory.get(key)
  if (!hit) return undefined
  memory.delete(key)
  memory.set(key, hit)
  return hit
}

/** `epoch` is the value of {@link authorEpoch} when the request started.
 * A bump since then means the list is stale and is discarded. */
export function rememberAuthors(repoPath: string, tip: string, authors: readonly string[], epoch?: number): void {
  if (epoch !== undefined && epoch !== authorEpoch(repoPath)) return
  const key = keyOf(repoPath, tip)
  memory.delete(key)
  memory.set(key, authors)
  while (memory.size > LIMIT) {
    const oldest = memory.keys().next().value
    if (oldest === undefined) break
    memory.delete(oldest)
  }
}

/** Drop every remembered list for one repository. */
export function forgetAuthors(repoPath: string): void {
  const prefix = `${repoPath}\0`
  for (const key of memory.keys()) if (key.startsWith(prefix)) memory.delete(key)
  epochs.set(repoPath, authorEpoch(repoPath) + 1)
}

/** Tests isolate one case from the next. */
export function resetAuthorCache(): void {
  memory.clear()
  epochs.clear()
}
