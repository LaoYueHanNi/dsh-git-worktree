import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { ReactElement, ReactNode } from 'react'
import { describeSync, SyncProgress } from '../src/client/SyncProgress.tsx'
import type { SyncJob } from '../src/client/sync-job.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ IconCloseOutlineRegular: 'svg' }))
// The card is portalled to document.body; for a node environment the portal is the identity.
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }))

// The server test config compiles JSX with the classic React runtime.
beforeAll(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('document', { body: {} })
})
afterAll(() => { vi.unstubAllGlobals() })

const t = ((key: string, params?: Record<string, unknown>) => params === undefined ? key : `${key}:${JSON.stringify(params)}`) as Parameters<typeof SyncProgress>[0]['t']
const job = (over: Partial<SyncJob> = {}): SyncJob => ({ id: 1, kind: 'fetch', cwd: 'C:/repo', stage: 'fetch', ...over })

/** Every element in a rendered tree, depth first. */
function elements(node: ReactNode, found: ReactElement<{ children?: ReactNode }>[] = []): ReactElement<{ children?: ReactNode }>[] {
  if (Array.isArray(node)) {
    node.forEach(child => elements(child as ReactNode, found))
  } else if (typeof node === 'object' && node !== null && 'props' in node) {
    const element = node as ReactElement<{ children?: ReactNode }>
    found.push(element)
    elements(element.props.children, found)
  }
  return found
}
const byClass = (tree: ReactNode, name: string): ReactElement<Record<string, unknown>> | undefined =>
  elements(tree).find(element => (element.props as { className?: string }).className?.includes(name)) as ReactElement<Record<string, unknown>> | undefined

describe('describeSync', () => {
  it('says "connecting" with an indeterminate bar until git has printed anything', () => {
    expect(describeSync(job(), 'main', t)).toEqual({ title: 'syncTitleFetch', detail: 'syncConnecting', percent: undefined, cancellable: true })
  })

  it('shows git’s own line and percentage for an update, naming the branch', () => {
    const view = describeSync(job({ kind: 'update', text: 'Receiving objects:  40% (2/5), 1.00 MiB | 512.00 KiB/s', percent: 40 }), 'main', t)
    expect(view).toEqual({
      title: 'syncTitleUpdate:{"branch":"main"}',
      detail: 'Receiving objects:  40% (2/5), 1.00 MiB | 512.00 KiB/s',
      percent: 40,
      cancellable: true,
    })
  })

  it('names the pushed branch and its remote for a push, not the checked-out branch', () => {
    const view = describeSync(job({ kind: 'push', branch: 'feature/x', remote: 'origin', text: 'Writing objects:  40% (2/5), 1.00 MiB | 512.00 KiB/s', percent: 40 }), 'main', t)
    expect(view).toEqual({
      title: 'syncTitlePush:{"branch":"feature/x"} · origin',
      detail: 'Writing objects:  40% (2/5), 1.00 MiB | 512.00 KiB/s',
      percent: 40,
      cancellable: true,
    })
    // A job that did not name its branch falls back to the checked-out one.
    expect(describeSync(job({ kind: 'push' }), 'main', t).title).toBe('syncTitlePush:{"branch":"main"}')
  })

  it('names the remote git is fetching in the title', () => {
    expect(describeSync(job({ remote: 'fork', text: 'Fetching fork' }), 'main', t).title).toBe('syncTitleFetch · fork')
  })

  it('keeps a line git gave without a percentage as an indeterminate bar', () => {
    expect(describeSync(job({ text: 'remote: Enumerating objects' }), 'main', t)).toMatchObject({ detail: 'remote: Enumerating objects', percent: undefined })
  })

  it('switches to the fast-forward wording and withdraws cancel at the merge step', () => {
    expect(describeSync(job({ kind: 'update', stage: 'merge' }), 'main', t)).toEqual({
      title: 'syncTitleUpdate:{"branch":"main"}',
      detail: 'syncMerging:{"branch":"main"}',
      percent: undefined,
      cancellable: false,
    })
  })
})

describe('SyncProgress card', () => {
  const render = (over: Partial<SyncJob> = {}, onCancel = vi.fn()) => SyncProgress({ job: job(over), branch: 'main', t, onCancel }) as unknown as ReactElement

  it('draws a determinate fill at git’s percentage and exposes it to assistive tech', () => {
    const tree = render({ text: 'Receiving objects:  40% (2/5)', percent: 40 })
    expect(byClass(tree, 'fill')?.props.style).toEqual({ width: '40%' })
    expect(byClass(tree, 'indeterminate')).toBeUndefined()
    expect(byClass(tree, 'track')?.props).toMatchObject({ role: 'progressbar', 'aria-valuenow': 40, 'aria-valuemin': 0, 'aria-valuemax': 100 })
    expect(byClass(tree, 'detail')?.props.children).toBe('Receiving objects:  40% (2/5)')
  })

  it('sweeps an indeterminate segment, with no value announced, when there is no percentage', () => {
    const tree = render()
    expect(byClass(tree, 'indeterminate')).toBeDefined()
    expect(byClass(tree, 'fill')).toBeUndefined()
    expect(byClass(tree, 'track')?.props).not.toHaveProperty('aria-valuenow')
    expect(byClass(tree, 'detail')?.props.children).toBe('syncConnecting')
  })

  it('offers a cancel button that calls onCancel, and withdraws it once the merge began', () => {
    const onCancel = vi.fn()
    const button = byClass(render({}, onCancel), 'cancel')!
    expect(button.props['aria-label']).toBe('syncCancel')
    ;(button.props.onClick as () => void)()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(byClass(render({ kind: 'update', stage: 'merge' }), 'cancel')).toBeUndefined()
  })

  it('is a polite status region that never grabs focus or blocks anything', () => {
    const tree = render()
    expect(tree.props).toMatchObject({ role: 'status', 'aria-live': 'polite' })
  })
})
