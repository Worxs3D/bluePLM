/**
 * Getting a report workbook to the user. The desktop writes it to a temp folder and opens it in
 * the default app (Excel), or saves it through the native dialog; BluePLM Web downloads it.
 */
import { saveBlobAs } from '@/lib/browserDownload'
import { hasDesktop } from '@/lib/platform'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function download(fileName: string, bytes: Uint8Array): void {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  saveBlobAs(fileName, new Blob([copy.buffer], { type: XLSX_MIME }))
}

export type DeliverOutcome = 'opened' | 'saved' | 'downloaded' | 'canceled'

/** Open a workbook in the default app (desktop) or download it (web). Throws on failure. */
export async function openWorkbook(fileName: string, bytes: Uint8Array): Promise<DeliverOutcome> {
  const api = hasDesktop() ? window.electronAPI?.inspectionReports : undefined
  if (!api) {
    download(fileName, bytes)
    return 'downloaded'
  }
  const result = await api.openWorkbook(fileName, toBase64(bytes))
  if (!result.success) throw new Error(result.error ?? 'Could not open the workbook')
  return 'opened'
}

/** Save a workbook where the user chooses (desktop) or download it (web). Throws on failure. */
export async function saveWorkbook(fileName: string, bytes: Uint8Array): Promise<DeliverOutcome> {
  const api = hasDesktop() ? window.electronAPI?.inspectionReports : undefined
  if (!api) {
    download(fileName, bytes)
    return 'downloaded'
  }
  const result = await api.saveWorkbook(fileName, toBase64(bytes))
  if (result.canceled) return 'canceled'
  if (!result.success) throw new Error(result.error ?? 'Could not save the workbook')
  return 'saved'
}

/** Ask the user for one .xlsx file through a file input (works on the desktop and the web). */
export function pickWorkbookFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `.xlsx,${XLSX_MIME}`
    let settled = false
    const finish = (file: File | null) => {
      if (settled) return
      settled = true
      resolve(file)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => finish(null))
    input.click()
  })
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}
