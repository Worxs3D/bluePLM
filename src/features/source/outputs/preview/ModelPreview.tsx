import { useEffect, useRef, useState } from 'react'
import { Box, Loader2, Maximize } from 'lucide-react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'

import type { ModelFormat } from './childPreviewModel'
import type { ModelView, ModelViewer } from './modelScene'

type ModelState =
  | { status: 'loading' }
  | { status: 'ready'; triangles: number }
  | { status: 'empty' }
  | { status: 'error'; message: string }

const VIEWS: ModelView[] = ['iso', 'front', 'top', 'right']

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Background of the view, read from the theme so the canvas matches the panel. */
function themeBackground(el: HTMLElement): string {
  const value = getComputedStyle(el).backgroundColor
  return value && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent' ? value : '#1e1e1e'
}

/**
 * A 3D view of a STEP, IGES or STL output: orbit (drag), pan (right-drag), zoom (wheel, at the
 * cursor), fit to one of four views, edges on or off. three.js and the tessellator load on
 * first use; the viewer is disposed (geometry, materials, WebGL context) when the preview goes.
 */
export function ModelPreview({ bytes, format }: { bytes: Uint8Array; format: ModelFormat }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<ModelViewer | null>(null)
  const [state, setState] = useState<ModelState>({ status: 'loading' })
  const [edges, setEdges] = useState(true)
  const [view, setView] = useState<ModelView>('iso')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let viewer: ModelViewer | null = null
    setState({ status: 'loading' })
    setView('iso')
    const run = async () => {
      const scene = await import('./modelScene')
      // Let the spinner paint: tessellation holds this thread.
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
      if (cancelled) return
      const meshes = await scene.parseModel(format, bytes)
      if (cancelled) return
      if (meshes.length === 0) {
        setState({ status: 'empty' })
        return
      }
      viewer = scene.createModelViewer(host, meshes, themeBackground(host))
      viewerRef.current = viewer
      setState({ status: 'ready', triangles: viewer.triangles })
    }
    run().catch((err: unknown) => {
      if (cancelled) return
      log.warn('[OutputPreview]', 'Model preview failed', { format, error: errorText(err) })
      setState({ status: 'error', message: errorText(err) })
    })
    return () => {
      cancelled = true
      viewer?.dispose()
      viewerRef.current = null
    }
  }, [bytes, format])

  useEffect(() => {
    viewerRef.current?.setEdges(edges)
  }, [edges, state.status])

  // Fit again once the toolbar has taken its row (the view was framed before it showed).
  useEffect(() => {
    if (state.status === 'ready') viewerRef.current?.setView('iso')
  }, [state.status])

  const pickView = (next: ModelView) => {
    setView(next)
    viewerRef.current?.setView(next)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={hostRef} className="model-preview-host relative min-h-0 flex-1 overflow-hidden bg-plm-bg-light" />
      {state.status !== 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-plm-fg-muted">
          {state.status === 'loading' ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              {t('source.outputs.previewPreparing3d')}
            </>
          ) : state.status === 'empty' ? (
            <>
              <Box size={32} className="opacity-40" />
              {t('source.outputs.previewModelEmpty')}
            </>
          ) : (
            <span className="text-plm-error">{t('source.outputs.previewFailed', { error: state.message })}</span>
          )}
        </div>
      )}
      {state.status === 'ready' && (
        <div className="flex shrink-0 items-center gap-1 border-t border-plm-border bg-plm-panel px-2 py-1">
          {VIEWS.map((v) => (
            <button
              key={v}
              onClick={() => pickView(v)}
              className={`rounded px-2 py-0.5 text-xs transition-colors ${
                view === v ? 'bg-plm-accent/20 text-plm-accent' : 'text-plm-fg-muted hover:bg-plm-bg-light hover:text-plm-fg'
              }`}
            >
              {t(`source.outputs.previewView_${v}`)}
            </button>
          ))}
          <div className="mx-1 h-4 w-px bg-plm-border" />
          <button
            onClick={() => pickView(view)}
            className="rounded p-1 text-plm-fg-muted transition-colors hover:bg-plm-bg-light hover:text-plm-fg"
            title={t('source.outputs.previewFitTitle')}
            aria-label={t('source.outputs.previewFitTitle')}
          >
            <Maximize size={14} />
          </button>
          <label className="ml-1 flex cursor-pointer select-none items-center gap-1.5 text-xs text-plm-fg-muted">
            <input type="checkbox" className="accent-plm-accent" checked={edges} onChange={(e) => setEdges(e.target.checked)} />
            {t('source.outputs.previewEdges')}
          </label>
          <span className="ml-auto truncate text-[11px] text-plm-fg-dim">
            {t('source.outputs.previewModelHint')} · {t('source.outputs.previewTriangles', { count: state.triangles.toLocaleString() })}
          </span>
        </div>
      )}
    </div>
  )
}
