import { usePDMStore } from '@/stores/pdmStore'

import type { ChildPreviewTarget } from './childPreviewModel'

/**
 * Select an output or report row: its parent file alone becomes the file selection, the row is
 * recorded against that exact selection (see childPreviewModel.ts), and the Preview tab is brought
 * forward wherever it lives (bottom details panel, or the right panel when the user moved it).
 */
export function selectChildRow(target: ChildPreviewTarget): void {
  const store = usePDMStore
  store.getState().setSelectedFiles([target.filePath])
  // The array the store now holds is the anchor; any later selection write replaces it.
  store.getState().setChildSelection({ target, anchor: store.getState().selectedFiles })

  const state = store.getState()
  if (state.rightPanelTabs.includes('preview')) {
    state.setRightPanelTab('preview')
    if (!state.rightPanelVisible) state.toggleRightPanel()
    return
  }
  if (state.detailsPanelTab !== 'preview') state.setDetailsPanelTab('preview')
  if (!state.detailsPanelVisible) state.toggleDetailsPanel()
}
