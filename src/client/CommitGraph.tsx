import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CommitDetail, CommitHistory } from '../wire.ts'
import { authorEpoch, cachedAuthors, forgetAuthors, rememberAuthors } from './author-cache.ts'
import { fetchAuthors, fetchCommit, fetchHistory } from './api.ts'
import { filterCommits, layoutCommits, shouldAutoLoadHistory, type GraphRow } from './commit-graph.ts'
import css from './CommitGraph.module.css'

type T = PropsLocale<'git-worktree'>['t']
const colors = ['#5c91cc', '#ac88d1', '#56a895', '#cf9b61', '#ce7d91', '#7c9daa']
const x = (lane: number): number => 12 + lane * 12
const color = (lane: number): string => colors[lane % colors.length] ?? colors[0] ?? '#5c91cc'

function GraphNode({ row, width, filtered }: { row: GraphRow; width: number; filtered: boolean }) {
  return <svg className={css.graph} width={width} height={36} aria-hidden="true">
    {!filtered && <>
      {row.incoming && <path d={`M${x(row.lane)} 0V18`} stroke={color(row.lane)} />}
      {row.edges.map((edge, i) => <path key={i} stroke={color(edge.parent ? edge.to : edge.from)} d={edge.parent
        ? `M${x(edge.from)} 18C${x(edge.from)} 29 ${x(edge.to)} 25 ${x(edge.to)} 36`
        : `M${x(edge.from)} 0C${x(edge.from)} 18 ${x(edge.to)} 18 ${x(edge.to)} 36`} />)}
    </>}
    <circle cx={x(filtered ? 0 : row.lane)} cy={18} r={3.6} fill={color(row.lane)} />
  </svg>
}

function Detail({ detail, t }: { detail: CommitDetail; t: T }) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const messageRef = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const el = messageRef.current
    if (!el) return
    const measure = (): void => { if (!expanded) setOverflows(el.scrollHeight > el.clientHeight + 1) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [detail.body, expanded])
  return <section className={`${css.detail} ${expanded ? css.expanded : ''}`} aria-label={t('graphDetail')}>
    <div className={css.detailTitle} title={detail.subject}>{detail.subject}</div>
    <div className={css.meta}>
      <span>{detail.author}</span><time dateTime={detail.date}>{new Date(detail.date).toLocaleString()}</time>
      <code title={detail.oid}>{detail.oid.slice(0, 8)}</code>
    </div>
    <div className={css.messageScroll}>
      <p ref={messageRef} className={css.message}>{detail.body || t('graphNoBody')}</p>
    </div>
    {(overflows || expanded) && <button type="button" className={css.textButton} aria-expanded={expanded}
      onClick={() => setExpanded(value => !value)}>{t(expanded ? 'graphCollapseBody' : 'graphExpandBody')}</button>}
    <div className={css.files} title={detail.firstFile ?? ''}>
      <span className={css.fileName}>{detail.firstFile ?? t('graphNoFiles')}</span>
      <span>{t('graphFiles', { count: detail.files })}</span>
      <span className={css.added}>+{detail.added}</span><span className={css.removed}>−{detail.removed}</span>
      {detail.binaryFiles > 0 && <span>{t('graphBinary', { count: detail.binaryFiles })}</span>}
    </div>
  </section>
}

/** One branch browser. The owner keys by repository + ref: old async responses
 * can never replace a different branch's history or selected commit. */
export function CommitGraph({ repoPath, branchRef, branch, branchEpoch = 0, onClose, escapeRef, t }: {
  repoPath: string
  branchRef: string
  branch: string
  /** Bumped when branch facts, fetch, or update may have moved a ref. */
  branchEpoch?: number
  onClose: () => void
  escapeRef: MutableRefObject<(() => boolean) | null>
  t: T
}) {
  const [history, setHistory] = useState<CommitHistory | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [author, setAuthor] = useState('')
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [detailError, setDetailError] = useState('')
  const [detailRevision, setDetailRevision] = useState(0)
  const [allAuthors, setAllAuthors] = useState<readonly string[] | null>(null)
  const moreRequest = useRef<AbortController | null>(null)
  const freshAuthors = useRef(false)
  const seenEpoch = useRef(branchEpoch)
  const historyGen = useRef(0)
  const historyApplied = useRef(0)
  if (seenEpoch.current !== branchEpoch) {
    seenEpoch.current = branchEpoch
    freshAuthors.current = true
    forgetAuthors(repoPath)
  }
  const pagingOffset = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const detailHost = useRef<HTMLDivElement>(null)

  const commits = history?.commits ?? []
  const graph = useMemo(() => layoutCommits(commits), [commits])
  const { visible, selected: selectedOid } = useMemo(() => filterCommits(commits, query, author, selected), [commits, query, author, selected])
  const authors = useMemo(() => {
    const names = new Set<string>(allAuthors ?? [])
    if (!allAuthors) for (const item of commits) if (item.author) names.add(item.author)
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [allAuthors, commits])
  const filtered = !!query.trim() || !!author
  const graphWidth = filtered ? 30 : Math.max(42, graph.lanes * 12 + 14)

  useEffect(() => {
    const controller = new AbortController()
    const gen = ++historyGen.current
    const reloadAuthors = freshAuthors.current
    freshAuthors.current = false
    moreRequest.current?.abort()
    pagingOffset.current = null
    setHistory(null); setError(''); setLoading(true); setSelected(null); setDetail(null)
    void fetchHistory({ repoPath, ref: branchRef, ...(reloadAuthors ? { freshAuthors: true } : {}) }, controller.signal).then(result => {
      if (controller.signal.aborted || historyGen.current !== gen) return
      historyApplied.current = gen
      setLoading(false)
      if (result.ok) { setHistory(result); setSelected(result.commits[0]?.oid ?? null) }
      else setError(result.error)
    })
    return () => { controller.abort(); moreRequest.current?.abort() }
  }, [repoPath, branchRef, revision, branchEpoch])

  useEffect(() => {
    // Wait until the history reload that drops the author cache has landed.
    // Reading the cache in the same turn would store the pre-update list again.
    if (historyApplied.current !== historyGen.current) {
      if (!history?.tip) setAllAuthors(null)
      return
    }
    const tip = history?.tip
    if (!tip) { setAllAuthors(null); return }
    const hit = cachedAuthors(repoPath, tip)
    if (hit) { setAllAuthors(hit); return }
    setAllAuthors(null)
    const epoch = authorEpoch(repoPath)
    const gen = historyGen.current
    const controller = new AbortController()
    void fetchAuthors({ repoPath, ref: branchRef, tip }, controller.signal).then(result => {
      if (controller.signal.aborted || !result.ok || result.tip !== tip) return
      if (authorEpoch(repoPath) !== epoch || historyGen.current !== gen) return
      rememberAuthors(repoPath, tip, result.authors, epoch)
      setAllAuthors(result.authors)
    })
    return () => controller.abort()
  }, [repoPath, branchRef, history])

  useEffect(() => {
    const controller = new AbortController()
    setDetail(null); setDetailError('')
    if (selectedOid !== null) void fetchCommit(repoPath, selectedOid, controller.signal).then(result => {
      if (controller.signal.aborted) return
      if (result.ok) setDetail(result)
      else setDetailError(result.error)
    })
    return () => controller.abort()
  }, [repoPath, selectedOid, detailRevision])

  useEffect(() => {
    const handler = (): boolean => {
      if (query) { setQuery(''); return true }
      if (author) { setAuthor(''); return true }
      const button = detailHost.current?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')
      if (button) { button.click(); return true }
      return false
    }
    escapeRef.current = handler
    return () => { if (escapeRef.current === handler) escapeRef.current = null }
  }, [escapeRef, query, author])

  const loadMore = async (): Promise<void> => {
    if (loading || history?.next == null || !history.tip) return
    // Scroll events repeat before the next paint. Hold this offset until the
    // page lands or the user explicitly retries, so the same page is not requested twice.
    if (pagingOffset.current === history.next) return
    const offset = history.next
    pagingOffset.current = offset
    moreRequest.current?.abort()
    const controller = new AbortController()
    moreRequest.current = controller
    setLoading(true); setError('')
    const result = await fetchHistory({ repoPath, ref: branchRef, tip: history.tip, offset: String(offset) }, controller.signal)
    if (controller.signal.aborted) return
    setLoading(false)
    if (result.ok) setHistory({ ...result, commits: [...history.commits, ...result.commits] })
    else setError(result.error)
    // Leave pagingOffset set. Clearing it here would let the still-attached
    // scroll handler request this same offset again before the next paint.
  }

  const reloadHistory = (): void => {
    freshAuthors.current = true
    forgetAuthors(repoPath)
    setRevision(value => value + 1)
  }

  const retryHistory = (): void => {
    pagingOffset.current = null
    if (history) void loadMore()
    else reloadHistory()
  }

  return <div className={css.panel} data-commit-history="" role="region" aria-label={t('graphTitle')}>
    <div className={css.heading}>
      <span className={css.branch} title={branch}>{branch}</span>
      <select className={css.authorFilter} aria-label={t('graphAuthorFilter')} value={author} onChange={event => setAuthor(event.target.value)}>
        <option value="">{t('graphAllAuthors')}</option>
        {authors.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
      <input className={css.search} value={query} onChange={event => setQuery(event.target.value)}
        placeholder={t('graphSearchPlaceholder')} aria-label={t('graphSearch')} spellCheck={false} />
      {history && <span className={css.loaded} title={t('graphLoaded', { count: commits.length })}>{t('graphLoaded', { count: commits.length })}</span>}
      <button type="button" className={css.iconButton} title={t('graphRefresh')} aria-label={t('graphRefresh')}
        disabled={loading} onClick={reloadHistory}>↻</button>
      <button type="button" className={css.iconButton} title={t('graphCloseWindow')} aria-label={t('graphCloseWindow')} onClick={onClose}><IconCloseOutlineRegular className={css.closeIcon} size={12} /></button>
    </div>
    <div className={css.columns} aria-hidden="true"><span style={{ width: graphWidth }}>{t('graphColumn')}</span><span>{t('graphCommit')}</span><span>{t('graphAuthor')}</span><span>{t('graphDate')}</span></div>
    <div ref={listRef} className={css.list} role="listbox" aria-label={t('graphCommits')} aria-busy={loading}
      onScroll={event => {
        const el = event.currentTarget
        if (!shouldAutoLoadHistory(el, { loading, hasNext: history?.next != null, failed: error !== '' })) return
        void loadMore()
      }}
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !visible.length) return
        event.preventDefault(); event.stopPropagation()
        const at = visible.findIndex(({ item }) => item.oid === selectedOid)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
          : Math.max(0, Math.min(visible.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))
        const oid = visible[next]?.item.oid
        if (oid) {
          setSelected(oid)
          const row = listRef.current?.querySelector<HTMLButtonElement>(`[data-oid="${oid}"]`)
          row?.focus(); row?.scrollIntoView({ block: 'nearest' })
        }
      }}>
      {visible.map(({ item, index }) => <button key={item.oid} type="button" role="option" aria-selected={item.oid === selectedOid}
        data-oid={item.oid} tabIndex={item.oid === selectedOid ? 0 : -1}
        className={`${css.row} ${item.oid === selectedOid ? css.selected : ''}`} onClick={() => setSelected(item.oid)}>
        <GraphNode row={graph.rows[index] ?? { lane: 0, incoming: false, edges: [] }} width={graphWidth} filtered={filtered} />
        <span className={css.subject} title={item.subject}>{item.subject}</span>
        <span className={css.author} title={item.author}>{item.author}</span>
        <time className={css.date} title={item.date} dateTime={item.date}>{new Date(item.date).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })}</time>
        <code className={css.hash}>{item.oid.slice(0, 7)}</code>
      </button>)}
      {!loading && !visible.length && !error && <div className={css.state}>{t(commits.length ? 'graphNoMatches' : 'graphEmpty')}</div>}
      {loading && <div className={css.state} role="status">{t('graphLoading')}</div>}
    </div>
    {(error || history?.next != null) && <div className={css.footer}>
      {error && <span className={css.error} role="alert" title={error}>{error}</span>}
      {error && <button type="button" className={css.textButton} disabled={loading} onClick={retryHistory}>{t('graphRetry')}</button>}
      {history?.next != null && !error && <button type="button" className={css.textButton} disabled={loading} onClick={() => void loadMore()}>{t('graphMore')}</button>}
    </div>}
    <div ref={detailHost} className={css.detailHost}>
      {detail && detail.oid === selectedOid && <Detail key={detail.oid} detail={detail} t={t} />}
      {selectedOid && detail?.oid !== selectedOid && <div className={css.state} role={detailError ? 'alert' : 'status'}>
        {detailError || t('graphLoading')}{detailError && <button type="button" className={css.textButton} onClick={() => setDetailRevision(value => value + 1)}>{t('graphRetry')}</button>}
      </div>}
    </div>
  </div>
}
