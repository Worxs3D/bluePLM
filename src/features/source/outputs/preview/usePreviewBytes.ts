import { useCallback, useEffect, useState } from 'react'

import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'

import { PREVIEW_MAX_BYTES, tooLargeToPreview, type PreviewContent, type PreviewKind } from './childPreviewModel'
import { loadPreviewBytes } from './previewBytes'

export type PreviewBytesState =
  | { status: 'loading' }
  | { status: 'ready'; bytes: Uint8Array }
  | { status: 'error'; message: string }
  /** Over the viewer's cap; `size` is what was recorded or downloaded. */
  | { status: 'tooLarge'; size: number }
  /** Signed out or no organization: nothing to read from. */
  | { status: 'unavailable' }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The verified bytes of a preview's content, with retry. Nothing is fetched for a 'none' kind. */
export function usePreviewBytes(
  content: PreviewContent,
  kind: PreviewKind['kind'],
): { state: PreviewBytesState; retry: () => void } {
  const orgId = usePDMStore((s) => s.organization?.id ?? null)
  const userId = usePDMStore((s) => s.user?.id ?? null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<PreviewBytesState>({ status: 'loading' })
  const { hash, size } = content

  useEffect(() => {
    if (kind === 'none') return
    if (!orgId || !userId) {
      setState({ status: 'unavailable' })
      return
    }
    if (tooLargeToPreview(kind, size)) {
      setState({ status: 'tooLarge', size: size ?? 0 })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    loadPreviewBytes(userId, orgId, hash)
      .then((bytes) => {
        if (cancelled) return
        // A returned workbook has no recorded size: its cap is checked once it is here.
        if (bytes.byteLength > PREVIEW_MAX_BYTES[kind]) setState({ status: 'tooLarge', size: bytes.byteLength })
        else setState({ status: 'ready', bytes })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        log.warn('[OutputPreview]', 'Preview download failed', { hash, error: errorText(err) })
        setState({ status: 'error', message: errorText(err) })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, userId, hash, size, kind, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { state, retry }
}
