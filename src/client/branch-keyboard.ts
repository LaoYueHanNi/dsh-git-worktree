/**
 * Branch keyboard shortcuts and context-menu dispatch.
 * Decoupled from the DOM component for pure-function testability.
 */

export interface KeyboardEventLike {
  key: string
  code?: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  preventDefault: () => void
}

export interface RectLike {
  left: number
  top: number
  bottom: number
  width: number
  height: number
}

/** Check if the event represents a context-menu trigger (ContextMenu key or Shift+F10). */
export function isContextMenuKey(event: KeyboardEventLike): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return false
  if (event.key === 'ContextMenu') return true
  if (event.shiftKey && (event.key === 'F10' || event.code === 'F10')) return true
  return false
}

/** Check if the event represents an Alt+Enter / Option+Enter trigger. */
export function isAltEnterKey(event: KeyboardEventLike): boolean {
  if (event.ctrlKey || event.metaKey) return false
  const isEnter = event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter'
  return isEnter && event.altKey
}

export interface DispatchParams {
  event: KeyboardEventLike
  selected: string | null
  currentBranch: string
  canWorktree: boolean
  isSearchInput: boolean
  leaves: readonly string[]
  getElementRect: (branch: string) => RectLike | null
}

export interface DispatchActions {
  onOpenContextMenu: (target: { name: string; x: number; y: number }) => void
  onWorktree: (branch: string) => void
  onCutWorktree: (branch: string) => void
  onPick: (branch: string) => void
  onSelect: (branch: string) => void
  onFocusTarget: (index: number) => void
}

export type DispatchResult = 'handled' | 'ignored'

export function dispatchBranchMenuKeyDown(
  params: DispatchParams,
  actions: DispatchActions,
): DispatchResult {
  const { event, selected, currentBranch, canWorktree, isSearchInput, leaves, getElementRect } = params
  const { key } = event

  // 1. ContextMenu / Shift+F10
  if (isContextMenuKey(event)) {
    if (selected !== null) {
      event.preventDefault()
      const rect = getElementRect(selected)
      const x = rect !== null ? rect.left + 24 : 0
      const y = rect !== null ? rect.bottom : 0
      actions.onOpenContextMenu({ name: selected, x, y })
      return 'handled'
    }
  }

  // 2. Alt+Enter (or macOS Option+Enter)
  if (isAltEnterKey(event)) {
    if (selected !== null) {
      event.preventDefault()
      if (!canWorktree) {
        // Started session: silently intercept
        return 'handled'
      }
      if (selected === currentBranch) {
        actions.onCutWorktree(selected)
      } else {
        actions.onWorktree(selected)
      }
      return 'handled'
    }
  }

  // 3. Arrow navigation
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (leaves.length === 0) return 'ignored'
    event.preventDefault()
    const idx = selected === null ? -1 : leaves.indexOf(selected)
    let next: number
    if (key === 'ArrowDown') {
      if (isSearchInput && idx < 0) {
        next = 0
      } else {
        next = idx < 0 ? 0 : Math.min(leaves.length - 1, idx + 1)
      }
    } else {
      if (isSearchInput && idx < 0) {
        next = leaves.length - 1
      } else {
        next = idx <= 0 ? leaves.length - 1 : idx - 1
      }
    }
    const targetBranch = leaves[next]
    if (targetBranch !== undefined) {
      actions.onSelect(targetBranch)
      actions.onFocusTarget(next)
      return 'handled'
    }
  }

  // 4. Plain Enter
  if (isSearchInput) {
    // Keep search field's commitFirst
    return 'ignored'
  }

  if (key === 'Enter' && selected !== null && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault()
    actions.onPick(selected)
    return 'handled'
  }

  return 'ignored'
}
