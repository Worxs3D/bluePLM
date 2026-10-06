import { ExternalLink, FileBox, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/lib/i18n'
import { log } from '@/lib/logger'
import {
  CONTEXT_MENU_CLOSE_EVENT,
  CONTEXT_MENU_OPEN_EVENT,
  createNativePreviewVisibilityController,
  observeNativePreviewOverlays,
} from './nativePreviewOverlay'
import { createPreviewSessionLifecycle } from './previewSessionLifecycle'

type PreviewState = 'loading' | 'ready' | 'unavailable' | 'error'
type EDrawingsPreviewApi = NonNullable<Window['electronAPI']>
type EDrawingsPreviewErrorCode = Extract<
  Awaited<ReturnType<EDrawingsPreviewApi['createEDrawingsPreview']>>,
  { success: false }
>['errorCode']

interface EDrawingsEmbeddedPreviewProps {
  fileName: string
  filePath: string
  hasLocalContent: boolean
  onOpenExternal: () => void
}

const PREVIEW_ERROR_KEYS: Record<EDrawingsPreviewErrorCode, string> = {
  'preview-service-unavailable': 'solidworksSettings.previewServiceUnavailable',
  'preview-session-not-active': 'solidworksSettings.previewSessionUnavailable',
  'preview-request-not-from-window': 'solidworksSettings.previewSessionUnavailable',
  'preview-module-unavailable': 'solidworksSettings.previewUnavailable',
  'preview-host-unavailable': 'solidworksSettings.previewHostUnavailable',
  'preview-host-handshake-failed': 'solidworksSettings.previewHostUnavailable',
  'preview-host-timeout': 'solidworksSettings.previewHostTimeout',
  'preview-host-exited': 'solidworksSettings.previewHostUnavailable',
  'preview-document-load-failed': 'solidworksSettings.previewDocumentLoadFailed',
  'preview-file-invalid': 'solidworksSettings.previewFileUnavailable',
  'preview-vault-unavailable': 'solidworksSettings.previewFileUnavailable',
  'preview-vault-not-local': 'solidworksSettings.previewNotLocal',
  'preview-file-not-allowed': 'solidworksSettings.previewFileUnavailable',
  'preview-file-type-unsupported': 'solidworksSettings.previewFileUnavailable',
  'preview-file-not-available': 'solidworksSettings.previewFileUnavailable',
  'preview-file-outside-vault': 'solidworksSettings.previewFileUnavailable',
  'preview-bounds-invalid': 'solidworksSettings.previewBoundsUnavailable',
  'preview-operation-failed': 'solidworksSettings.previewStartFailed',
}

/**
 * Optional Windows-only preview. The native process is explicitly created and
 * destroyed for this panel, so it can never adopt an eDrawings window opened by
 * the user outside BluePLM.
 */
export function EDrawingsEmbeddedPreview({
  fileName,
  filePath,
  hasLocalContent,
  onOpenExternal,
}: EDrawingsEmbeddedPreviewProps) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<PreviewState>('loading')
  const [errorCode, setErrorCode] = useState<EDrawingsPreviewErrorCode | null>(null)

  useEffect(() => {
    const lifecycle = createPreviewSessionLifecycle()
    let destroyed = false
    let observer: ResizeObserver | undefined
    let stopObservingOverlays: (() => void) | undefined
    const api = window.electronAPI

    const isActiveSession = (expectedSessionId: string) =>
      lifecycle.isActive(expectedSessionId)

    const destroy = async () => {
      const currentSessionId = lifecycle.sessionId
      if (!api || !currentSessionId || destroyed) return
      destroyed = true
      try {
        await api.destroyEDrawingsPreview(currentSessionId)
        if (!isActiveSession(currentSessionId)) return
      } catch (error) {
        if (!isActiveSession(currentSessionId)) return
        log.warn('[EDrawingsPreview]', 'Failed to destroy embedded preview', { error })
      }
    }

    const fail = (code: EDrawingsPreviewErrorCode) => {
      const currentSessionId = lifecycle.sessionId
      if (currentSessionId && !isActiveSession(currentSessionId)) return
      if (lifecycle.disposed) return
      log.error('[EDrawingsPreview]', 'Embedded preview request failed', { code, filePath })
      setErrorCode(code)
      setState('error')
      void destroy()
    }

    const syncBounds = async (expectedSessionId: string): Promise<boolean> => {
      if (!api || !isActiveSession(expectedSessionId)) return false
      const rect = host.current?.getBoundingClientRect()
      if (!rect || rect.width < 1 || rect.height < 1) return true
      const scale = window.devicePixelRatio || 1
      const result = await api.setEDrawingsBounds(
        expectedSessionId,
        rect.left * scale,
        rect.top * scale,
        rect.width * scale,
        rect.height * scale,
      )
      if (!isActiveSession(expectedSessionId)) return false
      if (!result.success) {
        fail(result.errorCode)
        return false
      }
      return true
    }

    const syncActiveBounds = () => {
      if (lifecycle.sessionId) void syncBounds(lifecycle.sessionId)
    }

    const visibility = createNativePreviewVisibilityController({
      hide: async () => {
        const currentSessionId = lifecycle.sessionId
        if (!api || !currentSessionId || !isActiveSession(currentSessionId)) return
        const result = await api.hideEDrawingsPreview(currentSessionId)
        if (!isActiveSession(currentSessionId)) return
        if (!result.success) fail(result.errorCode)
      },
      prepareShow: () => {
        const currentSessionId = lifecycle.sessionId
        return currentSessionId ? syncBounds(currentSessionId) : undefined
      },
      show: async () => {
        const currentSessionId = lifecycle.sessionId
        if (!api || !currentSessionId || !isActiveSession(currentSessionId)) return
        const result = await api.showEDrawingsPreview(currentSessionId)
        if (!isActiveSession(currentSessionId)) return
        if (!result.success) fail(result.errorCode)
      },
    })

    const handleContextMenuOpen = () => {
      if (lifecycle.disposed) return
      visibility.setContextMenuOpen(true)
    }
    const handleContextMenuClose = () => {
      if (lifecycle.disposed) return
      visibility.setContextMenuOpen(false)
    }
    const handleOutsideContextMenu = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.('.context-menu')) return
      handleContextMenuClose()
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleContextMenuClose()
    }

    const start = async () => {
      if (!hasLocalContent) {
        if (!lifecycle.disposed) {
          setErrorCode('preview-vault-not-local')
          setState('error')
        }
        return
      }
      if (!api) {
        if (!lifecycle.disposed) setState('unavailable')
        return
      }
      const nativeAvailable = await api.isEDrawingsNativeAvailable()
      if (lifecycle.disposed) return
      if (!nativeAvailable) {
        if (!lifecycle.disposed) setState('unavailable')
        return
      }
      const created = await api.createEDrawingsPreview()
      if (!created.success) {
        if (!lifecycle.disposed) fail(created.errorCode)
        return
      }
      lifecycle.registerSession(created.sessionId)
      if (!isActiveSession(created.sessionId)) {
        void destroy()
        return
      }
      const attached = await api.attachEDrawingsPreview(created.sessionId)
      if (!isActiveSession(created.sessionId)) return
      if (!attached.success) {
        fail(attached.errorCode)
        return
      }
      // The Windows host embeds itself during process creation, so it needs
      // the final panel bounds before we start it rather than afterwards.
      if (!(await syncBounds(created.sessionId)) || !isActiveSession(created.sessionId)) return
      const loaded = await api.loadEDrawingsFile(created.sessionId, filePath)
      if (!isActiveSession(created.sessionId)) return
      if (!loaded.success) {
        fail(loaded.errorCode)
        return
      }
      // A request being accepted is not a visual-ready signal. Phase B resolves
      // this same request with ready:true only after native document completion.
      if (!loaded.ready) return
      if (!(await syncBounds(created.sessionId)) || !isActiveSession(created.sessionId)) return
      if (host.current) {
        stopObservingOverlays = observeNativePreviewOverlays(host.current, visibility.setOverlayCount)
      }
      // The controller is the only production show/hide seam. A menu opened
      // during startup therefore results in hide, never an unconditional show.
      visibility.setReady(true)
      observer = new ResizeObserver(syncActiveBounds)
      if (host.current) observer.observe(host.current)
      window.addEventListener('resize', syncActiveBounds)
      // Scroll does not bubble, but the capture phase reaches the DetailsPanel's
      // scroll container without coupling this preview to its implementation.
      window.addEventListener('scroll', syncActiveBounds, true)
      setState('ready')
    }

    // Register before startup so a menu opened while the native child window is
    // being created is applied as soon as the preview becomes ready.
    window.addEventListener(CONTEXT_MENU_OPEN_EVENT, handleContextMenuOpen)
    window.addEventListener(CONTEXT_MENU_CLOSE_EVENT, handleContextMenuClose)
    document.addEventListener('pointerdown', handleOutsideContextMenu)
    document.addEventListener('keydown', handleEscape)

    setState('loading')
    setErrorCode(null)
    void start().catch((error) => {
      if (lifecycle.disposed) return
      log.error('[EDrawingsPreview]', 'Failed to start embedded preview', {
        error: error instanceof Error ? error.message : String(error),
        filePath,
      })
      fail('preview-operation-failed')
    })
    return () => {
      lifecycle.dispose()
      visibility.setReady(false)
      observer?.disconnect()
      stopObservingOverlays?.()
      window.removeEventListener('resize', syncActiveBounds)
      window.removeEventListener('scroll', syncActiveBounds, true)
      window.removeEventListener(CONTEXT_MENU_OPEN_EVENT, handleContextMenuOpen)
      window.removeEventListener(CONTEXT_MENU_CLOSE_EVENT, handleContextMenuClose)
      document.removeEventListener('pointerdown', handleOutsideContextMenu)
      document.removeEventListener('keydown', handleEscape)
      void destroy()
    }
  }, [filePath, hasLocalContent])

  return (
    <div ref={host} className="h-full flex-1 relative min-h-0 bg-plm-bg rounded overflow-hidden">
      {state === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-plm-fg-muted gap-3">
          <Loader2 className="animate-spin" size={28} />
          <span className="text-sm">{t('solidworksSettings.previewStarting')}</span>
        </div>
      )}
      {state !== 'loading' && state !== 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
          <FileBox size={42} className="mb-3 text-plm-accent" />
          <div className="text-sm font-medium">{fileName}</div>
          <p className="text-xs text-plm-fg-muted mt-2 max-w-sm">
            {state === 'unavailable'
              ? t('solidworksSettings.previewUnavailable')
              : t(errorCode ? PREVIEW_ERROR_KEYS[errorCode] : 'solidworksSettings.previewStartFailed')}
          </p>
          <button onClick={onOpenExternal} className="btn btn-secondary gap-2 mt-4">
            <ExternalLink size={16} />
            {t('solidworksSettings.openInEDrawings')}
          </button>
        </div>
      )}
    </div>
  )
}
