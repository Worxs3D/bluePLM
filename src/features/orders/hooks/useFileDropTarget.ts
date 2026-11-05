/**
 * A drop target for files dragged from the file list or the explorer tree (5.13.0): `over` while
 * such a drag is above the element, and `onFiles` with the store's files when they are dropped.
 * Only `PDM_FILES_DATA_TYPE` drags are taken (never files from outside the app); with `enabled`
 * false the drop is refused, so a sent order shows the "not allowed" cursor.
 */

import { useCallback, useRef, useState, type DragEvent } from 'react'

import { PDM_FILES_DATA_TYPE } from '@/lib/fileOperations/types'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'

import { filesForDraggedPaths, parseDraggedPaths } from '../lib/fileDrop'

export interface FileDropHandlers {
  onDragEnter: (e: DragEvent<HTMLElement>) => void
  onDragOver: (e: DragEvent<HTMLElement>) => void
  onDragLeave: (e: DragEvent<HTMLElement>) => void
  onDrop: (e: DragEvent<HTMLElement>) => void
}

const carriesFiles = (e: DragEvent<HTMLElement>) => e.dataTransfer.types.includes(PDM_FILES_DATA_TYPE)

export function useFileDropTarget(
  onFiles: (found: LocalFile[], orderable: LocalFile[]) => void,
  enabled: boolean,
): { over: boolean; handlers: FileDropHandlers } {
  const [over, setOver] = useState(false)
  // Enter and leave fire for every child the pointer crosses; count them.
  const depth = useRef(0)

  const onDragEnter = useCallback(
    (e: DragEvent<HTMLElement>) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depth.current += 1
      if (enabled) setOver(true)
    },
    [enabled],
  )
  const onDragOver = useCallback(
    (e: DragEvent<HTMLElement>) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = enabled ? 'copy' : 'none'
    },
    [enabled],
  )
  const onDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    if (!carriesFiles(e)) return
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setOver(false)
  }, [])
  const onDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      depth.current = 0
      setOver(false)
      if (!enabled) return
      const paths = parseDraggedPaths(e.dataTransfer.getData(PDM_FILES_DATA_TYPE))
      const { found, orderable } = filesForDraggedPaths(paths, usePDMStore.getState().files)
      onFiles(found, orderable)
    },
    [enabled, onFiles],
  )

  return { over: over && enabled, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}
