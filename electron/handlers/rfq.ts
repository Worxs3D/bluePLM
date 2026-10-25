/**
 * RFQ release files and HTML-to-PDF generation.
 *
 * These channels were registered in the old monolithic main.ts and were lost when it was split
 * into handler modules (abb782b2, January 2026): the preload kept exposing them, so every RFQ
 * export, release ZIP and RFQ PDF failed with "No handler registered". Found by
 * `electron/preload.contract.test.ts`. Restored here with the same channel names and result
 * shapes `src/electron.d.ts` promises; the ZIP is built with JSZip instead of the old
 * PowerShell / `zip` shell command, which put file paths inside a command string.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import JSZip from 'jszip'

import { sendSWCommand } from './solidworks'

let log: (message: string, data?: unknown) => void = console.log
let logError: (message: string, data?: unknown) => void = console.error

export interface RfqHandlerDependencies {
  log: (message: string, data?: unknown) => void
  logError: (message: string, data?: unknown) => void
}

type ExportType = 'step' | 'pdf' | 'dxf' | 'iges'

/** The per-RFQ folder under userData, created if missing. */
function rfqOutputDir(rfqId: string, rfqNumber?: string): string {
  const dir = path.join(app.getPath('userData'), 'rfq-releases', rfqNumber || rfqId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function generatePdfFromHtml(htmlContent: string, outputPath: string) {
  log('[PDF] Generating PDF', { outputPath })
  let pdfWindow: BrowserWindow | null = null
  try {
    pdfWindow = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, offscreen: true },
    })
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`)
    // Give fonts and images a moment to render before printing.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
    })
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, pdfBuffer)
    log('[PDF] PDF written', { outputPath, size: pdfBuffer.length })
    return { success: true, path: outputPath, size: pdfBuffer.length }
  } catch (err) {
    logError('[PDF] Failed to generate PDF', { error: String(err), outputPath })
    return { success: false, error: errorMessage(err) }
  } finally {
    if (pdfWindow && !pdfWindow.isDestroyed()) pdfWindow.destroy()
  }
}

async function exportReleaseFile(options: {
  rfqId: string
  rfqNumber?: string
  sourceFilePath: string
  exportType: ExportType
  partNumber?: string
  revision?: string
  configuration?: string
}) {
  try {
    const { rfqId, rfqNumber, sourceFilePath, exportType, partNumber, revision, configuration } =
      options
    const rfqDir = rfqOutputDir(rfqId, rfqNumber)

    const baseName = partNumber || path.basename(sourceFilePath, path.extname(sourceFilePath))
    const revSuffix = revision ? `_REV${revision}` : ''
    const configSuffix = configuration ? `_${configuration}` : ''
    const fileName = `${baseName}${revSuffix}${configSuffix}.${exportType}`
    const outputPath = path.join(rfqDir, fileName)

    let result
    switch (exportType) {
      case 'step':
        result = await sendSWCommand({
          action: 'exportStep',
          filePath: sourceFilePath,
          outputPath,
          exportAllConfigs: false,
          configuration: configuration || undefined,
        })
        break
      case 'pdf':
        result = await sendSWCommand({ action: 'exportPdf', filePath: sourceFilePath, outputPath })
        break
      case 'dxf':
        result = await sendSWCommand({ action: 'exportDxf', filePath: sourceFilePath, outputPath })
        break
      case 'iges':
        result = await sendSWCommand({ action: 'exportIges', filePath: sourceFilePath, outputPath })
        break
      default:
        return { success: false, error: 'Invalid export type' }
    }

    if (!result?.success) return { success: false, error: result?.error || 'Export failed' }
    const fileSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0
    return { success: true, outputPath, fileName, fileSize }
  } catch (err) {
    logError('[RFQ] Export failed', { error: String(err) })
    return { success: false, error: errorMessage(err) }
  }
}

async function createZip(options: {
  rfqId: string
  rfqNumber: string
  files: Array<{ path: string; name: string }>
  rfqPdfPath?: string
  outputPath?: string
}) {
  try {
    const { rfqId, rfqNumber, files, rfqPdfPath, outputPath } = options
    const zipPath =
      outputPath || path.join(rfqOutputDir(rfqId, rfqNumber), `${rfqNumber}_ReleasePackage.zip`)
    fs.mkdirSync(path.dirname(zipPath), { recursive: true })

    const zip = new JSZip()
    for (const file of files) {
      if (fs.existsSync(file.path)) zip.file(file.name, fs.readFileSync(file.path))
    }
    if (rfqPdfPath && fs.existsSync(rfqPdfPath)) {
      zip.file(`${rfqNumber}_RFQ.pdf`, fs.readFileSync(rfqPdfPath))
    }

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    fs.writeFileSync(zipPath, buffer)
    log('[RFQ] Release package written', { zipPath, size: buffer.length })
    return { success: true, zipPath, fileSize: buffer.length }
  } catch (err) {
    logError('[RFQ] Failed to create release package', { error: String(err) })
    return { success: false, error: errorMessage(err) }
  }
}

export function registerRfqHandlers(_window: BrowserWindow, deps: RfqHandlerDependencies): void {
  log = deps.log
  logError = deps.logError

  ipcMain.handle('pdf:generate-from-html', (_, htmlContent: string, outputPath: string) =>
    generatePdfFromHtml(htmlContent, outputPath),
  )

  ipcMain.handle('rfq:get-output-dir', (_, rfqId: string, rfqNumber?: string) => {
    try {
      return { success: true, path: rfqOutputDir(rfqId, rfqNumber) }
    } catch (err) {
      return { success: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle('rfq:export-release-file', (_, options: Parameters<typeof exportReleaseFile>[0]) =>
    exportReleaseFile(options),
  )

  ipcMain.handle('rfq:create-zip', (_, options: Parameters<typeof createZip>[0]) =>
    createZip(options),
  )

  ipcMain.handle('rfq:open-folder', async (_, rfqId: string, rfqNumber?: string) => {
    try {
      const error = await shell.openPath(rfqOutputDir(rfqId, rfqNumber))
      return error ? { success: false, error } : { success: true }
    } catch (err) {
      return { success: false, error: errorMessage(err) }
    }
  })
}

export function unregisterRfqHandlers(): void {
  ipcMain.removeHandler('pdf:generate-from-html')
  ipcMain.removeHandler('rfq:get-output-dir')
  ipcMain.removeHandler('rfq:export-release-file')
  ipcMain.removeHandler('rfq:create-zip')
  ipcMain.removeHandler('rfq:open-folder')
}
