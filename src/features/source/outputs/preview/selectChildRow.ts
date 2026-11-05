import { usePDMStore } from '@/stores/pdmStore'

import {
  activeChildTargets,
  childKey,
  nextChildSelection,
  type ChildClickMode,
  type ChildPreviewTarget,
} from './childPreviewModel'

/**
 * Select an output or report row: its parent file alone becomes the file selection, the row is
 * recorded against that exact selection (see childPreviewModel.ts), and the Preview tab is brought
 * forward wherever it lives (bottom details panel, or the right panel when the user moved it).
 * A right-click selects without `reveal`: the row highlights and an open Preview follows it, but
 * no panel opens under the menu.
 */
export function selectChildRow(target: ChildPreviewTarget, { reveal = true }: { reveal?: boolean } = {}): void {
  const store = usePDMStore
  store.getState().setSelectedFiles([target.filePath])
  // The array the store now holds is the anchor; any later selection write replaces it.
  store.getState().setChildSelection({ target, anchor: store.getState().selectedFiles })

  if (!reveal) return
  const state = store.getState()
  if (state.rightPanelTabs.includes('preview')) {
    state.setRightPanelTab('preview')
    if (!state.rightPanelVisible) state.toggleRightPanel()
    return
  }
  if (state.detailsPanelTab !== 'preview') state.setDetailsPanelTab('preview')
  if (!state.detailsPanelVisible) state.toggleDetailsPanel()
}

/** The click modifiers of a child row: Shift ranges, Ctrl/Cmd toggles. */
export function childClickMode(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): ChildClickMode {
  if (e.shiftKey) return 'range'
  if (e.ctrlKey || e.metaKey) return 'toggle'
  return 'replace'
}

/**
 * A click on a child row. A plain click is `selectChildRow`; Ctrl/Shift extend the selection under
 * the same parent (`order`: its selectable child rows in list order) without opening a panel.
 */
export function clickChildRow(
  target: ChildPreviewTarget,
  mode: ChildClickMode,
  order: () => readonly ChildPreviewTarget[],
): void {
  if (mode === 'replace') {
    selectChildRow(target)
    return
  }
  const state = usePDMStore.getState()
  const current = activeChildTargets(state.childSelection, state.selectedFiles)
  const selection = state.childSelection
  const pivot = current.length > 0 && selection ? (selection.pivot ?? childKey(selection.target)) : null
  const next = nextChildSelection(current, pivot, target, mode, order())
  state.setSelectedFiles([target.filePath])
  // The array the store now holds is the anchor, as in selectChildRow.
  usePDMStore.getState().setChildSelection(next && { ...next, anchor: usePDMStore.getState().selectedFiles })
}
