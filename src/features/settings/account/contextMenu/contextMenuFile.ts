/**
 * A right-click menu layout as a file, to move it between computers or hand it to an admin for a
 * template. The file holds one layout; anything read back goes through `sanitizeLayout`.
 */

import { saveBlobAs } from '@/lib/browserDownload'
import { sanitizeLayout } from '@/lib/contextMenu/sanitize'
import type { MenuLayout } from '@/lib/contextMenu/types'
import type { ToastType } from '@/stores/types'

import type { Translate } from './entryText'

type Toast = (type: ToastType, message: string) => void

const FORMAT = 'blueplm-context-menu'
const FILE_NAME = 'blueplm-right-click-menu.json'
/** A layout file is a few KB; anything this big is not one, and is refused before it is read. */
export const MAX_LAYOUT_FILE_BYTES = 256 * 1024

export function serializeLayout(layout: MenuLayout): string {
  return `${JSON.stringify({ format: FORMAT, v: 1, layout }, null, 2)}\n`
}

export type ParsedLayoutFile = { ok: true; layout: MenuLayout } | { ok: false; error: 'invalidJson' | 'notLayout' }

/** Reads a layout file's text. A bare layout (no wrapper) is accepted too. */
export function parseLayoutFile(text: string): ParsedLayoutFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'invalidJson' }
  }
  const candidate =
    typeof raw === 'object' && raw !== null && (raw as { format?: unknown }).format === FORMAT
      ? (raw as { layout?: unknown }).layout
      : raw
  const layout = sanitizeLayout(candidate)
  if (!layout || layout.nodes.length === 0) return { ok: false, error: 'notLayout' }
  return { ok: true, layout }
}

/** Saves a layout: a save dialog on desktop, a download on the web. */
export async function exportLayoutFile(layout: MenuLayout, t: Translate, toast: Toast): Promise<void> {
  const json = serializeLayout(layout)
  const api = window.electronAPI
  if (!api) {
    saveBlobAs(FILE_NAME, new Blob([json], { type: 'application/json' }))
    toast('success', t('contextMenuCustomizer.file.exportedWeb'))
    return
  }
  try {
    const result = await api.saveTextFileWithDialog(FILE_NAME, json, [{ name: 'JSON', extensions: ['json'] }])
    if (result?.success && result.path) toast('success', t('contextMenuCustomizer.file.exported', { path: result.path }))
    else if (!result?.canceled) {
      toast('error', t('contextMenuCustomizer.file.exportFailed', { error: result?.error ?? '' }))
    }
  } catch (error) {
    toast('error', t('contextMenuCustomizer.file.exportFailed', { error: String(error) }))
  }
}

/** Reads a chosen file; returns its layout, or null after telling the person why not. */
export async function importLayoutFile(file: File, t: Translate, toast: Toast): Promise<MenuLayout | null> {
  if (file.size > MAX_LAYOUT_FILE_BYTES) {
    toast('error', t('contextMenuCustomizer.file.importTooLarge'))
    return null
  }
  const parsed = parseLayoutFile(await file.text())
  if (!parsed.ok) {
    toast(
      'error',
      t(parsed.error === 'invalidJson' ? 'contextMenuCustomizer.file.importInvalidJson' : 'contextMenuCustomizer.file.importNotLayout'),
    )
    return null
  }
  toast('success', t('contextMenuCustomizer.file.imported'))
  return parsed.layout
}
