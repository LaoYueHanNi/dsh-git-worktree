import { GitError, type Exec } from './git.js'
import type { CommitDetail, CommitHistory, HistoryCommit } from './wire.js'

export const HISTORY_PAGE_SIZE = 100
const FORMAT = '%H%x00%P%x00%an%x00%aI%x00%s'
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

async function run(exec: Exec, cwd: string, args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd, nonInteractive: true })
  if (result.code !== 0) throw new GitError(args, result.code, result.stderr)
  return result.stdout
}

function commit(fields: string[]): HistoryCommit {
  const [oid = '', parents = '', author = '', date = '', subject = ''] = fields
  return { oid, parents: parents.split(' ').filter(Boolean), author, date, subject }
}

/** Resolve only an explicit branch ref or HEAD, then use immutable OIDs for paging. */
export async function readHistory(exec: Exec, cwd: string, ref: string, tip?: string, offset = 0): Promise<CommitHistory> {
  if (ref !== 'HEAD' && !/^refs\/(heads|remotes)\/.+/.test(ref)) throw new Error('An explicit branch ref is required')
  if (tip !== undefined && !OID.test(tip)) throw new Error('Invalid history tip')
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error('Invalid history offset')
  if (ref !== 'HEAD') await run(exec, cwd, ['check-ref-format', ref])
  let resolved = tip
  if (resolved === undefined) {
    const result = await exec('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd, nonInteractive: true })
    if (result.code !== 0) {
      // An unborn current branch is a useful empty, other missing refs are errors.
      const head = await run(exec, cwd, ['symbolic-ref', '-q', 'HEAD']).catch(() => '')
      if (head.trim() && (ref === 'HEAD' || ref === head.trim())) return { tip: null, commits: [], next: null }
      throw new GitError(['rev-parse', ref], result.code, result.stderr)
    }
    resolved = result.stdout.trim()
    if (!OID.test(resolved)) throw new Error('Invalid resolved history tip')
  }
  const out = await run(exec, cwd, ['log', '--topo-order', '--no-show-signature', '--encoding=UTF-8', '-z', `--format=${FORMAT}`,
    `--max-count=${HISTORY_PAGE_SIZE + 1}`, `--skip=${offset}`, resolved, '--'])
  const fields = out.split('\0')
  if (fields.at(-1) === '') fields.pop()
  const commits: HistoryCommit[] = []
  for (let i = 0; i + 4 < fields.length; i += 5) commits.push(commit(fields.slice(i, i + 5)))
  const more = commits.length > HISTORY_PAGE_SIZE
  return { tip: resolved, commits: commits.slice(0, HISTORY_PAGE_SIZE), next: more ? offset + HISTORY_PAGE_SIZE : null }
}

/** No patches in this response; even a large commit only exposes one file name. */
export async function readCommit(exec: Exec, cwd: string, oid: string): Promise<CommitDetail> {
  if (!OID.test(oid)) throw new Error('Invalid commit OID')
  const out = await run(exec, cwd, ['show', '-s', '--no-show-signature', '--encoding=UTF-8', `--format=${FORMAT}%x00%b`, oid, '--'])
  const fields = out.split('\0')
  const info = commit(fields)
  const parent = info.parents[0]
  const stats = await run(exec, cwd, parent === undefined
    ? ['diff-tree', '--root', '--no-commit-id', '-r', '--numstat', '--no-renames', '--no-relative', '-z', oid, '--']
    : ['diff', '--numstat', '--no-renames', '--no-relative', '-z', parent, oid, '--'])
  let files = 0, added = 0, removed = 0, binaryFiles = 0
  let firstFile: string | null = null
  for (const entry of stats.split('\0')) {
    if (!entry) continue
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(entry)
    if (!match) continue
    files++
    firstFile ??= match[3] ?? null
    if (match[1] === '-' || match[2] === '-') binaryFiles++
    else { added += Number(match[1]); removed += Number(match[2]) }
  }
  return { ...info, body: (fields[5] ?? '').trimEnd(), files, firstFile, added, removed, binaryFiles }
}
