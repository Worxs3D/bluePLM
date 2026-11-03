import { usePDMStore, type LocalFile } from '@/stores/pdmStore'

/** Select the drawing and open its Inspection tab on the Reports view, with this report expanded. */
export function showReportInInspectionTab(file: LocalFile, reportId: string | null): void {
  const state = usePDMStore.getState()
  const fileId = file.pdmData?.id
  if (!fileId) return
  state.setSelectedFiles([file.path])
  state.setDetailsPanelTab('inspection')
  if (!state.detailsPanelVisible) state.toggleDetailsPanel()
  state.focusInspectionReports(fileId, reportId)
}
