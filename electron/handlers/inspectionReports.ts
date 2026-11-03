/**
 * Inspection report workbooks: open one in the default app, or save one where the user chooses.
 *
 * The general fs channels write only inside the vault, and a report workbook comes from the vault
 * bucket, not the vault folder. Opening writes the bytes into a folder of our own under the OS
 * temp folder (one subfolder per open, so a workbook still open in Excel is never overwritten),
 * then hands the file to the shell. The folder is pruned on every open: entries older than a week
 * go, and at most `MAX_ENTRIES` are kept. Saving goes through the native save dialog only.
 */
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

const OPEN_DIR = 'blueplm-inspection-reports'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 50
/** Generous for a workbook with drawing images; refuses anything absurd. */
const MAX_BYTES = 200 * 1024 * 1024

let log: (message: string, data?: unknown) => void = console.log
let logError: (message: string, data?: unknown) => void = console.error
let mainWindow: BrowserWindow | null = null

export interface InspectionReportHandlerDependencies {
  log: (message: string, data?: unknown) => void
  logError: (message: string, data?: unknown) => void
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** A bare `.xlsx` file name: no folders, no characters Windows refuses, never empty. */
export function safeWorkbookName(name: unknown): string {
  const raw = typeof name === 'string' ? path.basename(name.replace(/\\/g, '/')) : ''
  const cleaned = Array.from(raw)
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
  const base = cleaned.replace(/\.xlsx$/i, '') || 'inspection-report'
  return `${base}.xlsx`
}

function decode(base64: unknown): Buffer | null {
  if (typeof base64 !== 'string' || base64.length === 0) return null
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length === 0 || buffer.length > MAX_BYTES) return null
  return buffer
}

async function pruneOpenDir(root: string): Promise<void> {
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => [])
  const dirs: Array<{ full: string; mtime: number }> = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = path.join(root, entry.name)
    const stat = await fs.promises.stat(full).catch(() => null)
    if (stat) dirs.push({ full, mtime: stat.mtimeMs })
  }
  dirs.sort((a, b) => b.mtime - a.mtime)
  const now = Date.now()
  for (let i = 0; i < dirs.length; i++) {
    if (i < MAX_ENTRIES && now - dirs[i].mtime < MAX_AGE_MS) continue
    // A workbook still open in Excel is locked on Windows; it goes on a later prune.
    await fs.promises.rm(dirs[i].full, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function registerInspectionReportHandlers(
  window: BrowserWindow,
  deps: InspectionReportHandlerDependencies,
): void {
  mainWindow = window
  log = deps.log
  logError = deps.logError

  ipcMain.handle('inspection-reports:open-workbook', async (_, fileName: unknown, base64: unknown) => {
    const buffer = decode(base64)
    if (!buffer) return { success: false, error: 'No workbook data' }
    try {
      const root = path.join(os.tmpdir(), OPEN_DIR)
      await fs.promises.mkdir(root, { recursive: true })
      await pruneOpenDir(root)
      const dir = await fs.promises.mkdtemp(path.join(root, 'r-'))
      const target = path.join(dir, safeWorkbookName(fileName))
      await fs.promises.writeFile(target, buffer)
      const openError = await shell.openPath(target)
      if (openError) {
        logError('[InspectionReports] Could not open the workbook', { target, error: openError })
        return { success: false, path: target, error: openError }
      }
      log('[InspectionReports] Opened workbook', { target, bytes: buffer.length })
      return { success: true, path: target }
    } catch (err) {
      logError('[InspectionReports] Failed to open a workbook', { error: errorMessage(err) })
      return { success: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle('inspection-reports:save-workbook', async (_, defaultName: unknown, base64: unknown) => {
    const buffer = decode(base64)
    if (!buffer) return { success: false, error: 'No workbook data' }
    try {
      const options = {
        title: 'Save Inspection Report',
        defaultPath: safeWorkbookName(defaultName),
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      }
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { success: false, canceled: true }
      await fs.promises.writeFile(result.filePath, buffer)
      log('[InspectionReports] Saved workbook', { path: result.filePath, bytes: buffer.length })
      return { success: true, path: result.filePath }
    } catch (err) {
      logError('[InspectionReports] Failed to save a workbook', { error: errorMessage(err) })
      return { success: false, error: errorMessage(err) }
    }
  })
}

export function unregisterInspectionReportHandlers(): void {
  ipcMain.removeHandler('inspection-reports:open-workbook')
  ipcMain.removeHandler('inspection-reports:save-workbook')
  mainWindow = null
}
