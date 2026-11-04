/**
 * Which files of a context-menu selection can go into an order, and whether the menu offers
 * "With referenced parts". Shared by both file context menus and `countMenuItems.ts`.
 */

import type { LocalFile } from '@/stores/types'

type MenuFile = Pick<LocalFile, 'isDirectory' | 'pdmData' | 'diffStatus' | 'extension'>

/**
 * Files that can become order lines: checked in at least once, not folders, not move stubs or
 * files deleted on the server. The planner decides the rest (and says what it skipped).
 */
export function orderableFiles<T extends MenuFile>(files: readonly T[]): T[] {
  return files.filter(
    (f) =>
      !f.isDirectory &&
      !!f.pdmData?.id &&
      f.diffStatus !== 'moved_away' &&
      f.diffStatus !== 'deleted_remote',
  )
}

/** Whether the selection holds an assembly, whose referenced parts can be added with it. */
export function hasAssembly(files: readonly Pick<LocalFile, 'extension'>[]): boolean {
  return files.some((f) => f.extension.toLowerCase() === '.sldasm')
}
