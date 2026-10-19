import { GitError, type Exec } from './git.js'
import type { AuthorList, CommitDetail, CommitHistory, HistoryCommit } from './wire.js'

export const HISTORY_PAGE_SIZE = 100
/** Distinct author lists kept per repository path and pinned tip. */
const AUTHOR_CACHE_LIMIT = 32
const FORMAT = '%H%x00%P%x00%an%x00%aI%x00%s'
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const authorCache = new Map<string, readonly string[]>()
const authorInflight = new Map<string, Promise<readonly string[]>>()
const authorEpochs = new Map<string, number>()

/** Drops cached author lists. Tests use this so one file cannot leak into the next. */
export function resetAuthorCache(): void {
  authorCache.clear()
  authorInflight.clear()
  authorEpochs.clear()
}

/** Drop one repository's author lists. An in-flight walk started earlier
 * still finishes for its caller, but it does not refill the cache. */
export function invalidateAuthorCache(cwd: string): void {
  const prefix = `${cwd}\0`
  for (const key of authorCache.keys()) if (key.startsWith(prefix)) authorCache.delete(key)
  for (const key of authorInflight.keys()) if (key.startsWith(prefix)) authorInflight.delete(key)
  authorEpochs.set(cwd, (authorEpochs.get(cwd) ?? 0) + 1)
}

async function run(exec: Exec, cwd: string, args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd, nonInteractive: true })
  if (result.code !== 0) throw new GitError(args, result.code, result.stderr)
  return result.stdout
}

function commit(fields: string[]): HistoryCommit {
  const [oid = '', parents = '', author = '', date = '', subject = ''] = fields
  return { oid, parents: parents.split(' ').filter(Boolean), author, date, subject }
}

/** Explicit branch ref or HEAD, pinned to an immutable commit once known. Null is an unborn branch. */
async function resolveHistoryTip(exec: Exec, cwd: string, ref: string, tip?: string): Promise<string | null> {
  if (ref !== 'HEAD' && !/^refs\/(heads|remotes)\/.+/.test(ref)) throw new Error('An explicit branch ref is required')
  if (tip !== undefined && !OID.test(tip)) throw new Error('Invalid history tip')
  if (tip !== undefined) {
    if (ref !== 'HEAD') await run(exec, cwd, ['check-ref-format', ref])
    return tip
  }
  // Validating the ref and resolving it do not depend on each other. On
  // Windows the spawn itself is most of a local call, so they share one round.
  const format = ref === 'HEAD' ? Promise.resolve('') : run(exec, cwd, ['check-ref-format', ref])
  const pending = exec('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd, nonInteractive: true })
  const [, result] = await Promise.all([format, pending])
  if (result.code !== 0) {
    // An unborn current branch is a useful empty, other missing refs are errors.
    const head = await run(exec, cwd, ['symbolic-ref', '-q', 'HEAD']).catch(() => '')
    if (head.trim() && (ref === 'HEAD' || ref === head.trim())) return null
    throw new GitError(['rev-parse', ref], result.code, result.stderr)
  }
  const resolved = result.stdout.trim()
  if (!OID.test(resolved)) throw new Error('Invalid resolved history tip')
  return resolved
}

function rememberAuthors(key: string, authors: readonly string[]): readonly string[] {
  authorCache.delete(key)
  authorCache.set(key, authors)
  while (authorCache.size > AUTHOR_CACHE_LIMIT) {
    const oldest = authorCache.keys().next().value
    if (oldest === undefined) break
    authorCache.delete(oldest)
  }
  return authors
}

/** Every author name reachable from the branch, not only the loaded page.
 * The same repository path and tip reuse one in-memory list and share one in-flight walk.
 * `fresh` drops that repository's lists first: fetch, update, and an explicit reload
 * pass it because a branch ref can move, or a shallow history can grow, without the
 * caller knowing the previous tip is stale. */
export async function readAuthors(exec: Exec, cwd: string, ref: string, tip?: string, fresh = false): Promise<AuthorList> {
  const resolved = await resolveHistoryTip(exec, cwd, ref, tip)
  if (resolved === null) return { tip: null, authors: [] }
  if (fresh) invalidateAuthorCache(cwd)
  const key = `${cwd}\0${resolved}`
  const epoch = authorEpochs.get(cwd) ?? 0
  const cached = authorCache.get(key)
  if (cached) return { tip: resolved, authors: rememberAuthors(key, cached) }
  let pending = authorInflight.get(key)
  if (!pending) {
    let current!: Promise<readonly string[]>
    current = run(exec, cwd, ['log', '-z', '--no-show-signature', '--encoding=UTF-8', '--format=%an', resolved, '--']).then(out => {
      const names = new Set<string>()
      for (const name of out.split('\0')) if (name) names.add(name)
      const sorted = [...names].sort((a, b) => a.localeCompare(b))
      if (authorInflight.get(key) === current) authorInflight.delete(key)
      if ((authorEpochs.get(cwd) ?? 0) !== epoch) return sorted
      return rememberAuthors(key, sorted)
    }, error => {
      if (authorInflight.get(key) === current) authorInflight.delete(key)
      throw error
    })
    pending = current
    authorInflight.set(key, pending)
  }
  return { tip: resolved, authors: await pending }
}

/** Resolve only an explicit branch ref or HEAD, then use immutable OIDs for paging. */
export async function readHistory(exec: Exec, cwd: string, ref: string, tip?: string, offset = 0): Promise<CommitHistory> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error('Invalid history offset')
  const resolved = await resolveHistoryTip(exec, cwd, ref, tip)
  if (resolved === null) return { tip: null, commits: [], next: null }
  const out = await run(exec, cwd, ['log', '--topo-order', '--no-show-signature', '--encoding=UTF-8', '-z', `--format=${FORMAT}`,
    `--max-count=${HISTORY_PAGE_SIZE + 1}`, `--skip=${offset}`, resolved, '--'])
  const fields = out.split('\0')
  if (fields.at(-1) === '') fields.pop()
  const commits: HistoryCommit[] = []
  for (let i = 0; i + 4 < fields.length; i += 5) commits.push(commit(fields.slice(i, i + 5)))
  const more = commits.length > HISTORY_PAGE_SIZE
  return { tip: resolved, commits: commits.slice(0, HISTORY_PAGE_SIZE), next: more ? offset + HISTORY_PAGE_SIZE : null }
}

/** No patches in this response; even a large commit only exposes one file name.
 * Metadata and first-parent numstat come from one `git show`: a second
 * process was another full spawn on top of a diff that show already computed. */
export async function readCommit(exec: Exec, cwd: string, oid: string): Promise<CommitDetail> {
  if (!OID.test(oid)) throw new Error('Invalid commit OID')
  const out = await run(exec, cwd, ['show', '--first-parent', '--no-show-signature', '--encoding=UTF-8', '--numstat', '--no-renames', '--no-relative', `--format=${FORMAT}%x00%b`, '-z', oid, '--'])
  const fields = out.split('\0')
  const info = commit(fields)
  let files = 0, added = 0, removed = 0, binaryFiles = 0
  let firstFile: string | null = null
  // The format record ends at the body. Numstat rows follow, each NUL-terminated,
  // with a leading newline on the first row where show separates the message.
  for (const entry of fields.slice(6)) {
    const text = entry.replace(/^\n/, '')
    if (!text) continue
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(text)
    if (!match) continue
    files++
    firstFile ??= match[3] ?? null
    if (match[1] === '-' || match[2] === '-') binaryFiles++
    else { added += Number(match[1]); removed += Number(match[2]) }
  }
  return { ...info, body: (fields[5] ?? '').trimEnd(), files, firstFile, added, removed, binaryFiles }
}
