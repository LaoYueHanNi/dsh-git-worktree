import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { PushDialog, swallowMaskClick, type PushDialogProps } from '../src/client/PushDialog.tsx'
import { requestPushPlan, requestPushPreview } from '../src/client/api.ts'

const hooks = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: readonly unknown[] | undefined; cleanup?: (() => void) | undefined }
  let slots: Slot[] = []
  let cursor = 0
  let dirty = true
  let effects: Array<() => void> = []
  let output: unknown
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
    a !== undefined && b !== undefined && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  function memo<T>(fn: () => T, deps: readonly unknown[]): T {
    const index = cursor++
    if (!slots[index] || !same(slots[index]?.deps, deps)) slots[index] = { value: fn(), deps }
    return slots[index]?.value as T
  }
  function effect(fn: () => (() => void) | void, deps?: readonly unknown[]): void {
    const index = cursor++
    const previous = slots[index]
    if (previous && same(previous.deps, deps)) return
    slots[index] = { deps }
    effects.push(() => {
      previous?.cleanup?.()
      slots[index]!.cleanup = fn() ?? undefined
    })
  }
  return {
    useState<T>(initial: T | (() => T)) {
      const index = cursor++
      slots[index] ??= { value: typeof initial === 'function' ? (initial as () => T)() : initial }
      return [slots[index]!.value as T, (next: T | ((previous: T) => T)) => {
        const value = typeof next === 'function' ? (next as (previous: T) => T)(slots[index]!.value as T) : next
        if (!Object.is(value, slots[index]!.value)) {
          slots[index]!.value = value
          dirty = true
        }
      }] as const
    },
    useRef<T>(initial: T) {
      const index = cursor++
      slots[index] ??= { value: { current: initial } }
      return slots[index]!.value as { current: T }
    },
    useMemo: memo,
    useCallback: <T,>(fn: T, deps: readonly unknown[]) => memo(() => fn, deps),
    useEffect: effect,
    useLayoutEffect: effect,
    rerender() { dirty = true },
    async flush(render: () => unknown) {
      for (let i = 0; i < 12; i++) {
        if (dirty) {
          dirty = false
          cursor = 0
          output = render()
          const pending = effects
          effects = []
          pending.forEach(fn => fn())
        }
        await Promise.resolve()
      }
      if (dirty) throw new Error('dock did not settle')
      return output
    },
    unmount() {
      for (const slot of slots) slot.cleanup?.()
      slots = []
      effects = []
      cursor = 0
      dirty = true
      output = undefined
    },
  }
})


vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...hooks }))
vi.mock('../src/client/api.ts', () => ({ requestPushPlan: vi.fn(), requestPushPreview: vi.fn() }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: 'button', Modal: 'modal', Menu: 'menu', IconBranchOutlineRegular: 'svg', IconCloseOutlineRegular: 'svg' }))

const preview = { ok: true as const, sourceOid: 'a'.repeat(40), targetOid: 'b'.repeat(40), commits: [{ oid: 'a'.repeat(40), subject: 'one subject' }], total: 1, truncated: false }
let props: PushDialogProps
const render = () => PushDialog(props)
function nodes(output: unknown): React.ReactElement<Record<string, any>>[] {
  if (!React.isValidElement(output)) return []
  const element = output as React.ReactElement<Record<string, any>>
  return [element, ...React.Children.toArray(element.props.children).flatMap(nodes), ...nodes(element.props.anchor)]
}
function find(output: unknown, predicate: (p: Record<string, any>) => boolean) {
  const node = nodes(output).find(node => predicate(node.props))
  if (!node) throw new Error('control not found')
  return node.props
}
const push = (output: unknown) => find(output, p => p['data-modal-autofocus'] === true)
const remoteMenu = (output: unknown) => find(output, p => p.items?.[0]?.id === 'origin')
const forceMenu = (output: unknown) => find(output, p => p.items?.[0]?.id === 'force')

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  props = { repoPath: '/repo', repoName: 'repo', branch: 'feature/x', busy: false, t: ((key: string) => key) as PushDialogProps['t'], onClose: vi.fn(), onPush: vi.fn().mockResolvedValue(undefined) }
  vi.mocked(requestPushPlan).mockReset().mockResolvedValue({ ok: true, branch: 'feature/x', remote: 'origin', target: 'feature/x', remotes: ['origin', 'github'], confirm: false })
  vi.mocked(requestPushPreview).mockReset().mockResolvedValue(preview)
})
afterEach(() => { hooks.unmount(); vi.unstubAllGlobals() })

describe('push review dialog', () => {
  it('reuses the picker count before planning or reading subjects, without enabling push', async () => {
    props.branchInfo = { kind: 'local', name: 'feature/x', upstream: 'origin/feature/x', ahead: 2 }
    props.t = ((key: string, params?: { n?: number }) => `${key}:${params?.n ?? ''}`) as PushDialogProps['t']
    let planned!: (result: Awaited<ReturnType<typeof requestPushPlan>>) => void
    let local!: (result: Awaited<ReturnType<typeof requestPushPreview>>) => void
    let remote!: (result: Awaited<ReturnType<typeof requestPushPreview>>) => void
    vi.mocked(requestPushPlan).mockImplementation(() => new Promise(resolve => { planned = resolve }))
    vi.mocked(requestPushPreview).mockImplementation(body => new Promise(resolve => {
      if (body.localOnly) local = resolve
      else remote = resolve
    }))
    let output = await hooks.flush(render)
    expect(JSON.stringify(output)).toContain('aheadTitle.other:2')
    expect(JSON.stringify(output)).toContain('pushReadingCommits:')
    expect(JSON.stringify(output)).not.toContain('pushPlanning:')
    expect(requestPushPreview).not.toHaveBeenCalled()
    expect(push(output).disabled).toBe(true)
    planned({ ok: true, branch: 'feature/x', remote: 'origin', target: 'feature/x', remotes: ['origin', 'github'], confirm: false })
    output = await hooks.flush(render)
    expect(JSON.stringify(output)).toContain('pushCommitCount.other:2')
    expect(push(output).disabled).toBe(true)
    expect(push(output).title).toBe('pushCheckingRemote:')
    expect(forceMenu(output).items[0].disabled).toBe(true)
    push(output).onClick()
    forceMenu(output).onSelect('force')
    expect(props.onPush).not.toHaveBeenCalled()
    local({ ...preview, total: 2 })
    output = await hooks.flush(render)
    expect(JSON.stringify(output)).toContain('one subject')
    expect(JSON.stringify(output)).toContain('pushLocalChecking:')
    remote({ ...preview, total: 3 })
    output = await hooks.flush(render)
    expect(JSON.stringify(output)).toContain('pushCommitCount.other:3')
    expect(JSON.stringify(output)).not.toContain('pushCommitCount.other:2')
    expect(push(output).disabled).toBe(false)
    expect(push(output).title).toBeUndefined()
  })

  it.each([
    { kind: 'local' as const, name: 'feature/x', ahead: 2 },
    { kind: 'local' as const, name: 'feature/x', upstream: 'origin/feature/x', upstreamGone: true as const, ahead: 2 },
    { kind: 'local' as const, name: 'other', upstream: 'origin/feature/x', ahead: 2 },
    { kind: 'remote' as const, name: 'feature/x', upstream: 'origin/feature/x', ahead: 2 },
  ])('does not reuse unrelated or unavailable tracking facts: %j', async branchInfo => {
    props.branchInfo = branchInfo
    vi.mocked(requestPushPlan).mockImplementation(() => new Promise(() => {}))
    const output = await hooks.flush(render)
    expect(JSON.stringify(output)).not.toContain('aheadTitle')
    expect(JSON.stringify(output)).not.toContain('pushReadingCommits')
    expect(push(output).disabled).toBe(true)
  })

  it('drops the cached count when a different remote or target is selected', async () => {
    props.branchInfo = { kind: 'local', name: 'feature/x', upstream: 'origin/feature/x', ahead: 2 }
    props.t = ((key: string, params?: { n?: number }) => `${key}:${params?.n ?? ''}`) as PushDialogProps['t']
    vi.mocked(requestPushPreview).mockImplementation(() => new Promise(() => {}))
    let output = await hooks.flush(render)
    expect(JSON.stringify(output)).toContain('pushCommitCount.other:2')
    remoteMenu(output).onSelect('github')
    output = await hooks.flush(render)
    expect(JSON.stringify(output)).not.toContain('pushCommitCount.other:2')
    remoteMenu(output).onSelect('origin')
    output = await hooks.flush(render)
    expect(JSON.stringify(output)).toContain('pushCommitCount.other:2')
    find(output, p => p.title === 'pushEditTarget:').onClick()
    output = await hooks.flush(render)
    find(output, p => p.id === 'git-worktree-push-target').onChange({ target: { value: 'review/x' } })
    output = await hooks.flush(render)
    find(output, p => p.id === 'git-worktree-push-target').onKeyDown({
      key: 'Enter', nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn(),
    })
    output = await hooks.flush(render)
    expect(JSON.stringify(output)).not.toContain('pushCommitCount.other:2')
    expect(push(output).disabled).toBe(true)
  })

  it('does not apply the upstream count to a differently configured default push destination', async () => {
    props.branchInfo = { kind: 'local', name: 'feature/x', upstream: 'origin/main', ahead: 2 }
    vi.mocked(requestPushPreview).mockImplementation(() => new Promise(() => {}))
    const output = await hooks.flush(render)
    expect(JSON.stringify(output)).not.toContain('pushCommitCount')
    expect(JSON.stringify(output)).not.toContain('aheadTitle')
  })

  it('shows local commits during slow verification, but only submits the verified source and lease', async () => {
    let verify!: (result: Awaited<ReturnType<typeof requestPushPreview>>) => void
    vi.mocked(requestPushPreview).mockImplementation(body => body.localOnly
      ? Promise.resolve({ ...preview, targetOid: null }) : new Promise(resolve => { verify = resolve }))
    let output = await hooks.flush(render)
    expect(JSON.stringify(output)).toContain('one subject')
    expect(JSON.stringify(output)).toContain('pushLocalChecking')
    expect(nodes(output).some(node => node.props.children === 'pushNew')).toBe(false)
    expect(push(output).disabled).toBe(true)
    expect(forceMenu(output).items[0].disabled).toBe(true)
    // Even an already-queued event cannot send the display-only snapshot.
    push(output).onClick()
    forceMenu(output).onSelect('force')
    expect(props.onPush).not.toHaveBeenCalled()
    const verified = { ...preview, sourceOid: 'c'.repeat(40), targetOid: 'd'.repeat(40), commits: [{ oid: 'c', subject: 'verified subject' }] }
    verify(verified)
    output = await hooks.flush(render)
    expect(JSON.stringify(output)).toContain('verified subject')
    expect(JSON.stringify(output)).not.toContain('one subject')
    expect(JSON.stringify(output)).not.toContain('pushLocalChecking')
    expect(push(output).disabled).toBe(false)
    forceMenu(output).onSelect('force')
    await hooks.flush(render)
    expect(props.onPush).toHaveBeenCalledWith(expect.objectContaining({ sourceOid: verified.sourceOid, expectedTarget: verified.targetOid }))
  })

  it('keeps a verified result when the local snapshot arrives later, and ignores local failures', async () => {
    let local!: (result: Awaited<ReturnType<typeof requestPushPreview>>) => void
    vi.mocked(requestPushPreview).mockImplementation(body => body.localOnly
      ? new Promise(resolve => { local = resolve }) : Promise.resolve(preview))
    let output = await hooks.flush(render)
    expect(push(output).disabled).toBe(false)
    local({ ...preview, commits: [{ oid: 'old', subject: 'late local subject' }] })
    output = await hooks.flush(render)
    expect(JSON.stringify(output)).not.toContain('late local subject')
    vi.mocked(requestPushPreview).mockImplementation(body => Promise.resolve(body.localOnly
      ? { ok: false, error: 'missing local object' } : preview))
    remoteMenu(output).onSelect('github')
    output = await hooks.flush(render)
    expect(push(output).disabled).toBe(false)
    expect(JSON.stringify(output)).not.toContain('missing local object')
  })

  it('discards both local and remote snapshots of a previous destination', async () => {
    let local!: (result: Awaited<ReturnType<typeof requestPushPreview>>) => void
    let remote!: (result: Awaited<ReturnType<typeof requestPushPreview>>) => void
    vi.mocked(requestPushPreview).mockImplementation(body => body.remote === 'origin'
      ? new Promise(resolve => { if (body.localOnly) local = resolve; else remote = resolve }) : Promise.resolve(preview))
    let output = await hooks.flush(render)
    remoteMenu(output).onSelect('github')
    output = await hooks.flush(render)
    local({ ...preview, commits: [{ oid: 'old', subject: 'old local subject' }] })
    remote({ ok: false, error: 'old network failure' })
    output = await hooks.flush(render)
    expect(JSON.stringify(output)).not.toContain('old local subject')
    expect(JSON.stringify(output)).not.toContain('old network failure')
    expect(push(output).disabled).toBe(false)
  })

  it('loads the commit review, changes remote without pushing, and ignores a late preview', async () => {
    let late!: (result: Awaited<ReturnType<typeof requestPushPreview>>) => void
    vi.mocked(requestPushPreview).mockImplementation(body => body.remote === 'origin' && !body.localOnly
      ? new Promise(resolve => { late = resolve }) : Promise.resolve(preview))
    let output = await hooks.flush(render)
    expect(push(output).disabled).toBe(true)
    remoteMenu(output).onSelect('github')
    output = await hooks.flush(render)
    expect(requestPushPreview).toHaveBeenLastCalledWith({ repoPath: '/repo', branch: 'feature/x', remote: 'github', target: 'feature/x' })
    expect(props.onPush).not.toHaveBeenCalled()
    late({ ...preview, sourceOid: 'c'.repeat(40), commits: [{ oid: 'c', subject: 'stale subject' }] })
    output = await hooks.flush(render)
    expect(JSON.stringify(output)).not.toContain('stale subject')
    push(output).onClick()
    await hooks.flush(render)
    expect(props.onPush).toHaveBeenCalledWith({ remote: 'github', target: 'feature/x', sourceOid: preview.sourceOid, force: false, tags: 'none' })
  })

  it('applies Enter, prevents its default action and closes only the target editor', async () => {
    let output = await hooks.flush(render)
    find(output, p => p.title === 'pushEditTarget').onClick()
    output = await hooks.flush(render)
    find(output, p => p.id === 'git-worktree-push-target').onChange({ target: { value: 'review/x' } })
    output = await hooks.flush(render)
    const event = { key: 'Enter', nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    find(output, p => p.id === 'git-worktree-push-target').onKeyDown(event)
    output = await hooks.flush(render)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(nodes(output).some(node => node.props.id === 'git-worktree-push-target')).toBe(false)
    expect(requestPushPreview).toHaveBeenLastCalledWith({ repoPath: '/repo', branch: 'feature/x', remote: 'origin', target: 'review/x' })
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('keeps force push as one dropdown action, leases its target and forwards the selected tag scope', async () => {
    let output = await hooks.flush(render)
    find(output, p => p.type === 'checkbox').onChange({ target: { checked: true } })
    output = await hooks.flush(render)
    find(output, p => p.items?.[0]?.id === 'all').onSelect('follow')
    output = await hooks.flush(render)
    forceMenu(output).onSelect('force')
    forceMenu(output).onSelect('force')
    await hooks.flush(render)
    expect(props.onPush).toHaveBeenCalledTimes(1)
    expect(props.onPush).toHaveBeenCalledWith({ remote: 'origin', target: 'feature/x', sourceOid: preview.sourceOid, expectedTarget: preview.targetOid, force: true, tags: 'follow' })
  })

  it('disables a synced normal push, but permits an empty new branch and tag-only pushes', async () => {
    vi.mocked(requestPushPreview).mockResolvedValue({ ...preview, commits: [], total: 0 })
    let output = await hooks.flush(render)
    expect(push(output).disabled).toBe(true)
    find(output, p => p.type === 'checkbox').onChange({ target: { checked: true } })
    output = await hooks.flush(render)
    expect(push(output).disabled).toBe(false)
    vi.mocked(requestPushPreview).mockResolvedValue({ ...preview, targetOid: null, commits: [], total: 0 })
    remoteMenu(output).onSelect('github')
    output = await hooks.flush(render)
    find(output, p => p.type === 'checkbox').onChange({ target: { checked: false } })
    output = await hooks.flush(render)
    expect(push(output).disabled).toBe(false)
    expect(JSON.stringify(output)).toContain('pushNewEmpty')
  })

  it('retains the review on rejection and can refresh a failed preview', async () => {
    let failed = true
    vi.mocked(requestPushPreview).mockImplementation(body => Promise.resolve(!body.localOnly && failed
      ? { ok: false, error: 'authentication failed' } : preview))
    let output = await hooks.flush(render)
    expect(push(output).disabled).toBe(true)
    expect(JSON.stringify(output)).toContain('authentication failed')
    expect(JSON.stringify(output)).toContain('one subject')
    expect(JSON.stringify(output)).toContain('pushLocalUnverified')
    failed = false
    find(output, p => p['aria-label'] === 'pushRefresh').onClick()
    output = await hooks.flush(render)
    expect(push(output).disabled).toBe(false)
    vi.mocked(props.onPush).mockResolvedValueOnce('non-fast-forward')
    push(output).onClick()
    output = await hooks.flush(render)
    expect(JSON.stringify(output)).toContain('pushFailBehind')
    expect(props.onClose).not.toHaveBeenCalled()
  })

  describe('requests', () => {
    const plan = { ok: true as const, branch: 'feature/x', remote: 'origin', target: 'feature/x', remotes: ['origin', 'github'], confirm: false }
    const enter = () => ({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn() })

    it('takes the first local snapshot from the plan instead of asking for it again', async () => {
      vi.mocked(requestPushPlan).mockResolvedValue({ ...plan, local: { ...preview, targetOid: null } })
      vi.mocked(requestPushPreview).mockImplementation(() => new Promise(() => {}))
      let output = await hooks.flush(render)
      expect(JSON.stringify(output)).toContain('one subject')
      expect(JSON.stringify(output)).toContain('pushLocalChecking')
      expect(requestPushPreview).toHaveBeenCalledTimes(1)
      expect(requestPushPreview).toHaveBeenCalledWith({ repoPath: '/repo', branch: 'feature/x', remote: 'origin', target: 'feature/x' })
      // Another destination has no snapshot yet: both reads happen again.
      remoteMenu(output).onSelect('github')
      output = await hooks.flush(render)
      expect(requestPushPreview).toHaveBeenCalledTimes(3)
      expect(requestPushPreview).toHaveBeenCalledWith({ repoPath: '/repo', branch: 'feature/x', remote: 'github', target: 'feature/x', localOnly: true })
    })

    it('does not verify the destination again when the same remote or name is chosen again', async () => {
      let output = await hooks.flush(render)
      const calls = vi.mocked(requestPushPreview).mock.calls.length
      remoteMenu(output).onSelect('origin')
      output = await hooks.flush(render)
      find(output, p => p.title === 'pushEditTarget').onClick()
      output = await hooks.flush(render)
      find(output, p => p.id === 'git-worktree-push-target').onKeyDown(enter())
      output = await hooks.flush(render)
      expect(requestPushPreview).toHaveBeenCalledTimes(calls)
      expect(nodes(output).some(node => node.props.id === 'git-worktree-push-target')).toBe(false)
    })
  })

  describe('target editor', () => {
    const open = async () => {
      let output = await hooks.flush(render)
      find(output, p => p.title === 'pushEditTarget').onClick()
      output = await hooks.flush(render)
      return output
    }
    const editorOpen = (output: unknown) => nodes(output).some(node => node.props.id === 'git-worktree-push-target')

    it('stays open on outside interaction and closes only with the x button, discarding the typed name', async () => {
      let output = await open()
      find(output, p => p.id === 'git-worktree-push-target').onChange({ target: { value: 'review/x' } })
      output = await hooks.flush(render)
      expect(vi.mocked(document.addEventListener).mock.calls.map(call => call[0])).not.toContain('pointerdown')
      expect(editorOpen(output)).toBe(true)
      find(output, p => p['aria-label'] === 'pushEditTargetClose').onClick()
      output = await hooks.flush(render)
      expect(editorOpen(output)).toBe(false)
      expect(requestPushPreview).not.toHaveBeenCalledWith(expect.objectContaining({ target: 'review/x' }))
      expect(props.onClose).not.toHaveBeenCalled()
      // Reopening starts from the applied target again.
      find(output, p => p.title === 'pushEditTarget').onClick()
      output = await hooks.flush(render)
      expect(find(output, p => p.id === 'git-worktree-push-target').value).toBe('feature/x')
    })

    it('lets Escape close just the editor, and leaves Escape to the host otherwise', async () => {
      let output = await open()
      const escape = () => ({ key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() })
      const first = escape()
      find(output, p => typeof p.onKeyDownCapture === 'function').onKeyDownCapture(first)
      output = await hooks.flush(render)
      expect(first.preventDefault).toHaveBeenCalled()
      expect(first.stopPropagation).toHaveBeenCalled()
      expect(editorOpen(output)).toBe(false)
      const second = escape()
      find(output, p => typeof p.onKeyDownCapture === 'function').onKeyDownCapture(second)
      expect(second.preventDefault).not.toHaveBeenCalled()
      expect(second.stopPropagation).not.toHaveBeenCalled()
    })

    it('flags only an invalid name, not an empty draft', async () => {
      let output = await open()
      const invalid = async (value: string) => {
        find(output, p => p.id === 'git-worktree-push-target').onChange({ target: { value } })
        output = await hooks.flush(render)
        return find(output, p => p.id === 'git-worktree-push-target')['aria-invalid']
      }
      expect(await invalid('bad name')).toBe(true)
      expect(await invalid('')).toBe(false)
      expect(await invalid('review/x')).toBe(false)
    })
  })

  describe('mask clicks', () => {
    it('listens for clicks on the window before the host does, and stops on unmount', async () => {
      await hooks.flush(render)
      expect(window.addEventListener).toHaveBeenCalledWith('click', expect.any(Function), true)
      hooks.unmount()
      expect(window.removeEventListener).toHaveBeenCalledWith('click', expect.any(Function), true)
    })

    const mask = { id: 'mask' }
    const anchorWith = (sibling: unknown) => ({
      closest: (selector: string) => selector === '[role="dialog"]' ? { previousElementSibling: sibling } : null,
    }) as unknown as Element
    const click = (target: unknown) => ({ target: target as EventTarget | null, stopPropagation: vi.fn() })

    it('swallows a click on the element right before the dialog card', () => {
      const event = click(mask)
      expect(swallowMaskClick(event, anchorWith(mask))).toBe(true)
      expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['inside the dialog or a menu', click({ id: 'other' }), anchorWith(mask)],
      ['without a target', click(null), anchorWith(null)],
      ['when the mask is not there', click(mask), anchorWith(null)],
      ['when the dialog card is not found', click(mask), { closest: () => null } as unknown as Element],
      ['before the dialog is mounted', click(mask), null],
    ])('leaves a click alone %s', (_name, event, anchor) => {
      expect(swallowMaskClick(event, anchor)).toBe(false)
      expect(event.stopPropagation).not.toHaveBeenCalled()
    })
  })

  describe('push failures', () => {
    it('reads the preview again after a rejection, keeping the local list and the reason on screen', async () => {
      props.onPush = vi.fn().mockResolvedValue('! refs/heads/feature/x:refs/heads/feature/x [rejected] (fetch first)')
      let output = await hooks.flush(render)
      expect(requestPushPreview).toHaveBeenCalledTimes(2)
      push(output).onClick()
      output = await hooks.flush(render)
      expect(requestPushPreview).toHaveBeenCalledTimes(3)
      expect(vi.mocked(requestPushPreview).mock.calls.at(-1)?.[0]).not.toHaveProperty('localOnly')
      expect(JSON.stringify(output)).toContain('pushFailBehind')
      // The sentence explains it; git's own hint text adds nothing here.
      expect(JSON.stringify(output)).not.toContain('(fetch first)')
      expect(JSON.stringify(output)).toContain('one subject')
      expect(push(output).disabled).toBe(false)
    })

    it('does not read again after an authentication failure, which would only fail the same way', async () => {
      props.onPush = vi.fn().mockResolvedValue("fatal: Authentication failed for 'https://example.invalid/r.git'")
      let output = await hooks.flush(render)
      push(output).onClick()
      output = await hooks.flush(render)
      expect(requestPushPreview).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(output)).toContain('pushFailAuth')
    })

    it('explains a recognised cause above git\'s text where that text says more, and shows anything else as it is', async () => {
      props.onPush = vi.fn().mockResolvedValueOnce('! [remote rejected] (protected branch hook declined)').mockResolvedValueOnce('something unexpected')
      let output = await hooks.flush(render)
      push(output).onClick()
      output = await hooks.flush(render)
      expect(JSON.stringify(output)).toContain('pushFailRefused')
      expect(JSON.stringify(output)).toContain('protected branch hook declined')
      push(output).onClick()
      output = await hooks.flush(render)
      expect(JSON.stringify(output)).toContain('something unexpected')
      expect(JSON.stringify(output)).not.toContain('pushFail')
    })

    it('clears an old failure when another destination is chosen', async () => {
      props.onPush = vi.fn().mockResolvedValue('something unexpected')
      let output = await hooks.flush(render)
      push(output).onClick()
      output = await hooks.flush(render)
      expect(JSON.stringify(output)).toContain('something unexpected')
      remoteMenu(output).onSelect('github')
      output = await hooks.flush(render)
      expect(JSON.stringify(output)).not.toContain('something unexpected')
    })
  })

  describe('coming back after a failed push', () => {
    const failed = { branch: 'feature/x', remote: 'github', target: 'review/x', tags: 'follow' as const, error: '! refs/heads/feature/x:refs/heads/review/x [rejected] (fetch first)' }

    it('opens with git’s reason already shown, where the push went and with the tag choice it had', async () => {
      props.resume = failed
      const output = await hooks.flush(render)
      expect(JSON.stringify(output)).toContain('pushFailBehind')
      // The preview is read for the failed push's destination, not the default one.
      expect(vi.mocked(requestPushPreview).mock.calls.every(([body]) => body.remote === 'github' && body.target === 'review/x')).toBe(true)
      expect(vi.mocked(requestPushPreview).mock.calls.length).toBeGreaterThan(0)
      expect(JSON.stringify(output)).toContain('review/x')
      expect(find(output, p => p.type === 'checkbox').checked).toBe(true)
      expect(find(output, p => p.items?.[0]?.id === 'all').selectedId).toBe('follow')
      // One click from the retry, with exactly those choices.
      expect(push(output).disabled).toBe(false)
      push(output).onClick()
      await hooks.flush(render)
      expect(props.onPush).toHaveBeenCalledWith(expect.objectContaining({ remote: 'github', target: 'review/x', tags: 'follow', force: false }))
    })

    it('shows the reason of a failure that git explains only in its own words', async () => {
      props.resume = { ...failed, error: 'something unexpected' }
      expect(JSON.stringify(await hooks.flush(render))).toContain('something unexpected')
    })

    it('names a local pre-push hook in the user’s language and drops the command line and the generic trailer', async () => {
      const command = 'git -c remote.github.mirror=false push --porcelain --no-force --progress --set-upstream -- github refs/heads/dsh-test/deny:refs/heads/dsh-test/deny'
      const reason = 'dsh-test: pre-push hook refused refs/heads/dsh-test/deny\nerror: failed to push some refs'
      props.resume = { ...failed, error: `${command} failed (exit 1): ${reason}` }
      const output = JSON.stringify(await hooks.flush(render))
      expect(output).toContain('pushFailHook')
      expect(output).toContain('pre-push hook refused refs/heads/dsh-test/deny')
      expect(output).not.toContain('failed to push some refs')
      expect(output).not.toContain('mirror=false')
      expect(output).not.toContain('failed (exit')
      expect(output).not.toContain('pushFailRefused')
    })

    it('falls back to the repository’s own destination when that remote has been removed since, keeping the reason', async () => {
      props.resume = { ...failed, remote: 'removed-meanwhile' }
      const output = await hooks.flush(render)
      expect(vi.mocked(requestPushPreview).mock.calls.every(([body]) => body.remote === 'origin' && body.target === 'feature/x')).toBe(true)
      expect(JSON.stringify(output)).toContain('pushFailBehind')
    })

    it('keeps the default destination and the local snapshot when the failed push went there too', async () => {
      vi.mocked(requestPushPlan).mockResolvedValue({ ok: true, branch: 'feature/x', remote: 'origin', target: 'feature/x', remotes: ['origin', 'github'], confirm: false, local: { sourceOid: preview.sourceOid, targetOid: preview.targetOid, commits: preview.commits, total: 1, truncated: false } })
      props.resume = { ...failed, remote: 'origin', target: 'feature/x', tags: 'none' }
      await hooks.flush(render)
      // The plan's own snapshot is reused: no extra local-only read.
      expect(vi.mocked(requestPushPreview).mock.calls.filter(([body]) => body.localOnly === true)).toHaveLength(0)
    })

    it('is a normal window without it: nothing to explain, default tag choice', async () => {
      const output = await hooks.flush(render)
      expect(JSON.stringify(output)).not.toContain('pushFail')
      expect(find(output, p => p.type === 'checkbox').checked).toBe(false)
    })
  })

  it('uses the singular commit count text for exactly one commit', async () => {
    props.t = ((key: string, params?: { n?: number }) => `${key}:${params?.n ?? ''}`) as PushDialogProps['t']
    let output = await hooks.flush(render)
    expect(JSON.stringify(output)).toContain('pushCommitCount.one:1')
    vi.mocked(requestPushPreview).mockResolvedValue({ ...preview, total: 2 })
    remoteMenu(output).onSelect('github')
    output = await hooks.flush(render)
    expect(JSON.stringify(output)).toContain('pushCommitCount.other:2')
  })
})
