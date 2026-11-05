/**
 * Show a file in the explorer: expand its ancestor folders, open its folder in the file pane,
 * select it and scroll it into view. Used by the Pending view's file links and by review screens
 * ("Show in vault").
 */

import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'

export interface RevealFileOptions {
  /** Switch the sidebar to the explorer (default true). The Pending view keeps its own view. */
  switchView?: boolean
}

export function revealFile(file: Pick<LocalFile, 'path' | 'relativePath'>, options?: RevealFileOptions): void {
  const state = usePDMStore.getState()
  const parts = file.relativePath.split('/')
  parts.pop()
  const parentPath = parts.join('/')

  for (let i = 1; i <= parts.length; i++) {
    const ancestor = parts.slice(0, i).join('/')
    if (ancestor && !usePDMStore.getState().expandedFolders.has(ancestor)) state.toggleFolder(ancestor)
  }

  if (options?.switchView !== false && state.activeView !== 'explorer') state.setActiveView('explorer')
  state.setCurrentFolder(parentPath)
  state.setSelectedFiles([file.path])
  state.setPendingScrollToFile(file.path)
}

/**
 * Reveal the local row of a vault file by its `files.id`. Returns false when this machine has no
 * row with content for it (not in a connected vault, or only a moved-away stub).
 */
export function revealFileById(fileId: string, options?: RevealFileOptions): boolean {
  const file = usePDMStore
    .getState()
    .files.find((f) => f.pdmData?.id === fileId && f.diffStatus !== 'moved_away')
  if (!file) return false
  revealFile(file, options)
  return true
}
