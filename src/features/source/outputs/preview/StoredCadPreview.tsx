/**
 * A CAD file's Preview tab at full resolution: over the embedded thumbnail (which stays mounted
 * underneath and is what shows until, or unless, something better is ready), a drawing shows the
 * PDF of the version on disk and a part or assembly can show its STEP/STL export in 3D. The
 * outputs come from `fileOutputHeads` (read once per file and version when the file list has not
 * already); the bytes from the shared, bounded preview cache. Anything that fails, is missing, is
 * too large or belongs to another version leaves the thumbnail as it was.
 *
 * Cost: one small query per selected file (skipped when the file list already read it), one
 * download per PDF (cached by content hash), and pdf.js rendering at the panel's size. 3D is
 * opt-in (`modelPreview3d`) because tessellating a STEP holds the renderer thread.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { Box, Loader2 } from 'lucide-react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { loadOutputHeads } from '@/lib/outputs'
import { outputKindLabel } from '@/lib/outputs/kinds'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import { PdfAnnotationViewer } from '@/features/source/details/components/PdfAnnotationViewer'
import { openOutput } from '@/features/source/outputs/outputCommands'

import { previewContentOf } from './childPreviewModel'
import {
  pickStoredPreview,
  previewContentVersion,
  type StoredPreviewSource,
} from './storedPreviewSource'
import { usePreviewBytes } from './usePreviewBytes'

const ModelPreview = lazy(() => import('./ModelPreview').then((m) => ({ default: m.ModelPreview })))

const RETRY_AFTER_MS = 60_000
const MAX_ASKED_KEPT = 500
/** `${fileId}:${version}` -> when its output heads were last read for the Preview tab. */
const askedAt = new Map<string, number>()

function requestHeads(fileId: string, version: number): void {
  const key = `${fileId}:${version}`
  const now = Date.now()
  const last = askedAt.get(key)
  if (last !== undefined && now - last < RETRY_AFTER_MS) return
  askedAt.delete(key)
  askedAt.set(key, now)
  while (askedAt.size > MAX_ASKED_KEPT) {
    const oldest = askedAt.keys().next().value
    if (oldest === undefined) break
    askedAt.delete(oldest)
  }
  loadOutputHeads([fileId]).catch((err: unknown) =>
    log.debug('[CadPreview]', 'Stored outputs unavailable', {
      fileId,
      error: err instanceof Error ? err.message : String(err),
    }),
  )
}

/** The stored output to show for `file`, reading its output heads when none (of its version) are known. */
function useStoredPreviewSource(
  file: LocalFile,
  configuration: string | null | undefined,
  enabled: boolean,
): StoredPreviewSource | null {
  const fileId = file.pdmData?.id ?? null
  const heads = usePDMStore((s) => (fileId ? s.fileOutputHeads.get(fileId) : undefined))
  const signedIn = usePDMStore((s) => Boolean(s.user?.id && s.organization?.id))
  const version = previewContentVersion(file)
  const source = useMemo(
    () => (enabled ? pickStoredPreview(file, heads, configuration) : null),
    [enabled, file, heads, configuration],
  )
  const ext = (file.extension ?? '').toLowerCase()
  const kindOfFile = ext === '.slddrw' || ext === '.sldprt' || ext === '.sldasm'

  useEffect(() => {
    if (!enabled || !signedIn || !kindOfFile || !fileId || version === null || source) return
    // Heads already read and as new as this version: the outputs simply do not exist (yet; the
    // check-in queue refreshes the heads itself when it records one).
    if (heads !== undefined && heads.some((o) => o.version >= version)) return
    if (heads !== undefined && heads.length === 0 && askedAt.has(`${fileId}:${version}`)) return
    requestHeads(fileId, version)
  }, [enabled, signedIn, kindOfFile, fileId, version, source, heads])

  return source
}

function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div
      className="pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-[11px] text-plm-fg-muted backdrop-blur-sm"
      title={title}
    >
      {children}
    </div>
  )
}

function StoredLayer({ file, source }: { file: LocalFile; source: StoredPreviewSource }) {
  const content = useMemo(
    () =>
      previewContentOf({
        kind: 'output',
        filePath: file.path,
        fileId: source.output.fileId,
        version: source.output.version,
        output: source.output,
      }),
    [file.path, source.output],
  )
  const { state } = usePreviewBytes(content, source.kind.kind)
  const pdfFilePath = `blueplm-preview:${content.hash}.pdf`
  const readPdf = useCallback(
    async () =>
      state.status === 'ready' ? { success: true, bytes: state.bytes } : { success: false },
    [state],
  )
  const onOpen = useCallback(() => void openOutput(file, source.output), [file, source.output])
  const kindLabel = outputKindLabel(source.output.kind)

  if (state.status === 'loading') {
    return (
      <Chip>
        <Loader2 size={12} className="animate-spin" />
        {source.kind.kind === 'pdf'
          ? t('source.outputs.cadStoredLoadingPdf')
          : t('source.outputs.cadStoredLoading3d')}
      </Chip>
    )
  }
  if (state.status !== 'ready') {
    if (state.status === 'error') {
      return (
        <Chip>
          <span className="max-w-[18rem] truncate">
            {t('source.outputs.cadStoredFailed', { kind: kindLabel, error: state.message })}
          </span>
        </Chip>
      )
    }
    return null
  }

  return (
    <div className="absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden rounded-lg bg-plm-panel">
      {source.kind.kind === 'pdf' ? (
        <PdfAnnotationViewer
          key={content.hash}
          filePath={pdfFilePath}
          fileName={pdfFilePath}
          readData={readPdf}
          initialScale="page-fit"
          onOpenExternally={onOpen}
        />
      ) : (
        <Suspense
          fallback={
            <Chip>
              <Loader2 size={12} className="animate-spin" />
              {t('source.outputs.cadStoredLoading3d')}
            </Chip>
          }
        >
          <ModelPreview key={content.hash} bytes={state.bytes} format={source.kind.format} />
        </Suspense>
      )}
    </div>
  )
}

interface StoredCadPreviewProps {
  file: LocalFile
  /** The configuration the thumbnail shows (parts and assemblies). */
  configuration?: string | null
  /** False: the thumbnail alone (a side panel next to eDrawings, say). */
  enabled?: boolean
  /** The thumbnail view. Always mounted, so its own measuring and listeners keep working. */
  children: ReactNode
  className?: string
}

export function StoredCadPreview({
  file,
  configuration,
  enabled = true,
  children,
  className = '',
}: StoredCadPreviewProps) {
  const source = useStoredPreviewSource(file, configuration, enabled)
  const show3d = usePDMStore((s) => s.modelPreview3d)
  const setShow3d = usePDMStore((s) => s.setModelPreview3d)
  const isModel = source?.kind.kind === 'model'
  const active = source && (!isModel || show3d) ? source : null

  return (
    <div className={`relative flex min-h-0 flex-col ${className}`}>
      {children}
      {active && <StoredLayer key={active.output.storageHash} file={file} source={active} />}
      {source && isModel && (
        <button
          type="button"
          onClick={() => setShow3d(!show3d)}
          aria-pressed={show3d}
          className={`absolute right-12 top-3 z-20 flex items-center gap-1 rounded px-2 py-1 text-[11px] backdrop-blur-sm transition-colors ${
            show3d
              ? 'bg-sky-500/80 text-white hover:bg-sky-500'
              : 'bg-black/50 text-plm-fg-muted hover:bg-black/70 hover:text-white'
          }`}
          title={t(
            show3d ? 'source.outputs.cadStored3dOnTitle' : 'source.outputs.cadStored3dOffTitle',
            {
              kind: outputKindLabel(source.output.kind),
              version: source.output.version,
            },
          )}
        >
          <Box size={12} />
          {t('source.outputs.cadStored3d')}
        </button>
      )}
    </div>
  )
}
