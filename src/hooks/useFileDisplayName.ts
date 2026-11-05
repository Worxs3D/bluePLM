import { useCallback } from 'react'

import { fileDisplayName } from '@/lib/fileDisplayName'
import { usePDMStore } from '@/stores/pdmStore'

/** `fileDisplayName` bound to the user's "lowercase extensions" preference. */
export function useFileDisplayName(): (name: string) => string {
  const lowercase = usePDMStore((s) => s.lowercaseExtensions)
  return useCallback((name: string) => fileDisplayName(name, lowercase), [lowercase])
}

/** The same outside React (toasts, command handlers). */
export function displayFileName(name: string): string {
  return fileDisplayName(name, usePDMStore.getState().lowercaseExtensions)
}
