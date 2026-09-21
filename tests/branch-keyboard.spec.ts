import { describe, expect, it, vi } from 'vitest'
import {
  dispatchBranchMenuKeyDown,
  isAltEnterKey,
  isContextMenuKey,
  type DispatchActions,
  type DispatchParams,
  type KeyboardEventLike,
  type RectLike,
} from '../src/client/branch-keyboard.ts'

function createEvent(overrides: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
  return {
    key: '',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  }
}

function createSetup(overrides: Partial<DispatchParams> = {}) {
  const actions: DispatchActions = {
    onOpenContextMenu: vi.fn(),
    onWorktree: vi.fn(),
    onCutWorktree: vi.fn(),
    onPick: vi.fn(),
    onSelect: vi.fn(),
    onFocusTarget: vi.fn(),
  }

  const defaultRects: Record<string, RectLike> = {
    main: { left: 100, top: 50, bottom: 80, width: 200, height: 30 },
    feat: { left: 100, top: 80, bottom: 110, width: 200, height: 30 },
  }

  const params: DispatchParams = {
    event: createEvent(),
    selected: 'main',
    currentBranch: 'main',
    canWorktree: true,
    isSearchInput: false,
    leaves: ['main', 'feat'],
    getElementRect: (branch: string) => defaultRects[branch] ?? null,
    ...overrides,
  }

  return { params, actions }
}

describe('branch-keyboard', () => {
  describe('key matcher predicates', () => {
    it('matches ContextMenu key and Shift+F10', () => {
      expect(isContextMenuKey(createEvent({ key: 'ContextMenu' }))).toBe(true)
      expect(isContextMenuKey(createEvent({ key: 'F10', shiftKey: true }))).toBe(true)
      expect(isContextMenuKey(createEvent({ code: 'F10', shiftKey: true }))).toBe(true)

      // Suppressed with modifiers
      expect(isContextMenuKey(createEvent({ key: 'ContextMenu', ctrlKey: true }))).toBe(false)
      expect(isContextMenuKey(createEvent({ key: 'ContextMenu', altKey: true }))).toBe(false)
      expect(isContextMenuKey(createEvent({ key: 'ContextMenu', metaKey: true }))).toBe(false)
      expect(isContextMenuKey(createEvent({ key: 'F10' }))).toBe(false)
    })

    it('matches Alt+Enter (and macOS Option+Enter)', () => {
      expect(isAltEnterKey(createEvent({ key: 'Enter', altKey: true }))).toBe(true)
      expect(isAltEnterKey(createEvent({ code: 'Enter', altKey: true }))).toBe(true)
      expect(isAltEnterKey(createEvent({ code: 'NumpadEnter', altKey: true }))).toBe(true)

      // Suppressed with Ctrl or Meta
      expect(isAltEnterKey(createEvent({ key: 'Enter', altKey: true, ctrlKey: true }))).toBe(false)
      expect(isAltEnterKey(createEvent({ key: 'Enter', altKey: true, metaKey: true }))).toBe(false)
      expect(isAltEnterKey(createEvent({ key: 'Enter' }))).toBe(false)
    })
  })

  describe('ContextMenu and Shift+F10 dispatch', () => {
    it('opens context menu anchored to the selected row with Shift+F10', () => {
      const event = createEvent({ key: 'F10', shiftKey: true })
      const { params, actions } = createSetup({ event, selected: 'feat' })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('handled')
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(actions.onOpenContextMenu).toHaveBeenCalledWith({
        name: 'feat',
        x: 124, // 100 + 24
        y: 110, // rect.bottom
      })
    })

    it('opens context menu anchored to the selected row with ContextMenu key', () => {
      const event = createEvent({ key: 'ContextMenu' })
      const { params, actions } = createSetup({ event, selected: 'main' })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('handled')
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(actions.onOpenContextMenu).toHaveBeenCalledWith({
        name: 'main',
        x: 124, // 100 + 24
        y: 80, // rect.bottom
      })
    })

    it('does nothing when no branch is selected', () => {
      const event = createEvent({ key: 'ContextMenu' })
      const { params, actions } = createSetup({ event, selected: null })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('ignored')
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(actions.onOpenContextMenu).not.toHaveBeenCalled()
    })

    it('falls back to origin coordinates if element rect is null', () => {
      const event = createEvent({ key: 'ContextMenu' })
      const { params, actions } = createSetup({
        event,
        selected: 'unknown',
        getElementRect: () => null,
      })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('handled')
      expect(actions.onOpenContextMenu).toHaveBeenCalledWith({
        name: 'unknown',
        x: 0,
        y: 0,
      })
    })
  })

  describe('Alt+Enter shortcuts', () => {
    it('triggers onWorktree when selecting a non-current branch in blank session', () => {
      const event = createEvent({ key: 'Enter', altKey: true })
      const { params, actions } = createSetup({
        event,
        selected: 'feat',
        currentBranch: 'main',
        canWorktree: true,
      })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('handled')
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(actions.onWorktree).toHaveBeenCalledWith('feat')
      expect(actions.onCutWorktree).not.toHaveBeenCalled()
    })

    it('triggers onCutWorktree when selecting current branch in blank session', () => {
      const event = createEvent({ key: 'Enter', altKey: true })
      const { params, actions } = createSetup({
        event,
        selected: 'main',
        currentBranch: 'main',
        canWorktree: true,
      })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('handled')
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(actions.onCutWorktree).toHaveBeenCalledWith('main')
      expect(actions.onWorktree).not.toHaveBeenCalled()
    })

    it('silently intercepts Alt+Enter when canWorktree is false in a started session', () => {
      const event = createEvent({ key: 'Enter', altKey: true })
      const { params, actions } = createSetup({
        event,
        selected: 'feat',
        currentBranch: 'main',
        canWorktree: false,
      })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('handled')
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(actions.onWorktree).not.toHaveBeenCalled()
      expect(actions.onCutWorktree).not.toHaveBeenCalled()
    })

    it('ignores Alt+Enter when selected is null', () => {
      const event = createEvent({ key: 'Enter', altKey: true })
      const { params, actions } = createSetup({
        event,
        selected: null,
      })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('ignored')
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(actions.onWorktree).not.toHaveBeenCalled()
      expect(actions.onCutWorktree).not.toHaveBeenCalled()
    })
  })

  describe('arrow key navigation', () => {
    it('moves selection down through leaves', () => {
      const event = createEvent({ key: 'ArrowDown' })
      const { params, actions } = createSetup({
        event,
        selected: 'main',
        leaves: ['main', 'feat', 'fix'],
      })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('handled')
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(actions.onSelect).toHaveBeenCalledWith('feat')
      expect(actions.onFocusTarget).toHaveBeenCalledWith(1)
    })

    it('moves selection up through leaves', () => {
      const event = createEvent({ key: 'ArrowUp' })
      const { params, actions } = createSetup({
        event,
        selected: 'feat',
        leaves: ['main', 'feat', 'fix'],
      })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('handled')
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(actions.onSelect).toHaveBeenCalledWith('main')
      expect(actions.onFocusTarget).toHaveBeenCalledWith(0)
    })

    it('selects first leaf when pressing ArrowDown from search input', () => {
      const event = createEvent({ key: 'ArrowDown' })
      const { params, actions } = createSetup({
        event,
        selected: null,
        isSearchInput: true,
        leaves: ['feat/a', 'feat/b'],
      })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('handled')
      expect(actions.onSelect).toHaveBeenCalledWith('feat/a')
      expect(actions.onFocusTarget).toHaveBeenCalledWith(0)
    })

    it('selects last leaf when pressing ArrowUp from search input', () => {
      const event = createEvent({ key: 'ArrowUp' })
      const { params, actions } = createSetup({
        event,
        selected: null,
        isSearchInput: true,
        leaves: ['feat/a', 'feat/b'],
      })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('handled')
      expect(actions.onSelect).toHaveBeenCalledWith('feat/b')
      expect(actions.onFocusTarget).toHaveBeenCalledWith(1)
    })

    it('returns ignored when leaves is empty', () => {
      const event = createEvent({ key: 'ArrowDown' })
      const { params, actions } = createSetup({
        event,
        leaves: [],
      })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('ignored')
      expect(event.preventDefault).not.toHaveBeenCalled()
    })
  })

  describe('plain Enter and search input handling', () => {
    it('executes pick on plain Enter when a leaf is selected', () => {
      const event = createEvent({ key: 'Enter' })
      const { params, actions } = createSetup({
        event,
        selected: 'feat',
        isSearchInput: false,
      })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('handled')
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(actions.onPick).toHaveBeenCalledWith('feat')
    })

    it('ignores plain Enter when search input has focus to preserve commitFirst', () => {
      const event = createEvent({ key: 'Enter' })
      const { params, actions } = createSetup({
        event,
        selected: 'feat',
        isSearchInput: true,
      })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('ignored')
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(actions.onPick).not.toHaveBeenCalled()
    })

    it('ignores typing and normal keys', () => {
      const event = createEvent({ key: 'a' })
      const { params, actions } = createSetup({ event })

      const result = dispatchBranchMenuKeyDown(params, actions)

      expect(result).toBe('ignored')
      expect(event.preventDefault).not.toHaveBeenCalled()
    })
  })
})
