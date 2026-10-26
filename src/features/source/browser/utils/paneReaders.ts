/**
 * The file pane's lookup functions, built outside the component.
 *
 * Every closure created in one call of a function shares that call's scope, so a lookup written
 * as `useCallback` inside FilePane held all of that render: its file list, sorted rows, folder
 * metrics, and the other memoized callbacks it saw, each from the render that made it. Two
 * memoized callbacks whose inputs change at different times (the file list now, the deferred
 * folder metrics a moment later) then chain every render's scope to an older one, and a
 * long session kept every old file list alive (the render-perf nightly's heap leak). Built
 * here, each lookup closes over its one input and nothing else.
 */
import type { LocalFile } from '@/stores/pdmStore'
import type { OperationType } from '@/stores/types'

import { getFileProcessingOperation, getFolderProcessingOperation } from './processingStatus'

interface FolderFlags {
  isSynced: boolean
  hasMyCheckedOutFiles: boolean
  hasOthersCheckedOutFiles: boolean
}

/** Child folders of a folder, for the breadcrumb dropdowns. */
export function childFoldersReader(
  files: readonly LocalFile[],
): (parentPath: string) => Array<{ name: string; relativePath: string }> {
  return (parentPath) =>
    files
      .filter((f) => {
        if (!f.isDirectory) return false
        const rel = f.relativePath.replace(/\\/g, '/')
        if (parentPath === '') {
          return !rel.includes('/')
        }
        const prefix = parentPath + '/'
        if (!rel.startsWith(prefix)) return false
        const remainder = rel.slice(prefix.length)
        return !remainder.includes('/')
      })
      .map((f) => ({
        name: f.name,
        relativePath: f.relativePath.replace(/\\/g, '/'),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/** Whether every file in a folder is synced. An empty or unknown folder is not. */
export function folderSyncedReader(
  folderMetrics: ReadonlyMap<string, FolderFlags>,
): (folderPath: string) => boolean {
  return (folderPath) => folderMetrics.get(folderPath)?.isSynced ?? false
}

/** Whose checkouts a folder holds: 'mine' | 'others' | 'both' | null. */
export function folderCheckoutStatusReader(
  folderMetrics: ReadonlyMap<string, FolderFlags>,
): (folderPath: string) => 'mine' | 'others' | 'both' | null {
  return (folderPath) => {
    const fm = folderMetrics.get(folderPath)
    if (!fm) return null
    if (fm.hasMyCheckedOutFiles && fm.hasOthersCheckedOutFiles) return 'both'
    if (fm.hasMyCheckedOutFiles) return 'mine'
    if (fm.hasOthersCheckedOutFiles) return 'others'
    return null
  }
}

/** Whether a file or folder is affected by a running operation. */
export function processingReader(
  processingOperations: Map<string, OperationType>,
): (relativePath: string, isDirectory?: boolean) => boolean {
  return (relativePath, isDirectory = false) =>
    isDirectory
      ? getFolderProcessingOperation(relativePath, processingOperations) !== null
      : getFileProcessingOperation(relativePath, processingOperations) !== null
}
