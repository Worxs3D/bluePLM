/**
 * ui-look for workbooks: render an .xlsx the way a recipient sees it, headless.
 *
 * LibreOffice converts the workbook to PDF with the workbook's own print setup (orientation, fit
 * to width, print titles, page breaks, header and footer), then pdf.js in a hidden Electron window
 * rasterizes every page to a PNG, so the pages can be read like any other ui-look screenshot.
 *
 *   npx tsx scripts/ui-look/xlsx.ts report.xlsx [more.xlsx] --out ui-look-out/xlsx [--dpi 110]
 *
 * LibreOffice runs with a throwaway profile (`-env:UserInstallation`), so it never touches the
 * user's own LibreOffice settings or a running instance. `SOFFICE` overrides the executable path.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_SOFFICE = 'C:/Program Files/LibreOffice/program/soffice.exe'

export interface RenderedWorkbook {
  pdf: string
  pages: string[]
}

/** Convert one workbook to PDF in `outDir` with a private LibreOffice profile; returns the PDF path. */
export function workbookToPdf(xlsxPath: string, outDir: string): string {
  const soffice = process.env.SOFFICE ?? DEFAULT_SOFFICE
  if (!existsSync(soffice)) throw new Error(`LibreOffice not found at ${soffice} (set SOFFICE)`)
  const profile = mkdtempSync(join(tmpdir(), 'blueplm-lo-profile-'))
  try {
    const result = spawnSync(
      soffice,
      [
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        '--headless',
        '--norestore',
        '--nolockcheck',
        '--convert-to',
        'pdf',
        '--outdir',
        outDir,
        xlsxPath,
      ],
      { encoding: 'utf8', timeout: 180_000 },
    )
    const pdf = join(outDir, `${basename(xlsxPath, extname(xlsxPath))}.pdf`)
    if (result.status !== 0 || !existsSync(pdf)) {
      throw new Error(
        `LibreOffice conversion failed (${result.status}): ${result.stderr || result.stdout}`,
      )
    }
    return pdf
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
}

/**
 * The Electron main process pdfToPngs runs: one hidden window on a local page, so pdf.js draws on
 * Chromium's canvas as the app's own `rasterizePdf` does. (pdf.js in plain Node, on
 * @napi-rs/canvas, drops images with a soft mask, which is every logo and drawing page.)
 */
const RASTER_MAIN = `const { app, BrowserWindow } = require('electron')
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  win.loadFile(require('path').join(__dirname, 'index.html'))
})
app.on('window-all-closed', () => app.quit())
`

/** Rasterize every page of a PDF to `<prefix>-p<n>.png` (Electron + pdf.js); returns the PNG paths. */
export async function pdfToPngs(pdfPath: string, prefix: string, dpi = 110): Promise<string[]> {
  const { _electron } = await import('playwright')
  const dir = mkdtempSync(join(tmpdir(), 'blueplm-pdf-raster-'))
  writeFileSync(join(dir, 'main.cjs'), RASTER_MAIN)
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'blueplm-pdf-raster', main: 'main.cjs' }),
  )
  writeFileSync(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><body></body>')
  const pdfjsRoot = resolve(__dirname, '../../node_modules/pdfjs-dist/build')
  const app = await _electron.launch({ args: [dir], timeout: 60_000 })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('load')
    const pngs = await page.evaluate(
      async ({ data, lib, worker, scale }) => {
        const pdfjs = (await import(lib)) as typeof import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = worker
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
        const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise
        const pages: string[] = []
        for (let n = 1; n <= doc.numPages; n++) {
          const pdfPage = await doc.getPage(n)
          const viewport = pdfPage.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('2D canvas unavailable')
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          await pdfPage.render({ canvasContext: ctx, viewport }).promise
          pages.push(canvas.toDataURL('image/png').slice('data:image/png;base64,'.length))
        }
        await doc.destroy()
        return pages
      },
      {
        data: readFileSync(pdfPath).toString('base64'),
        lib: pathToFileURL(join(pdfjsRoot, 'pdf.min.mjs')).href,
        worker: pathToFileURL(join(pdfjsRoot, 'pdf.worker.min.mjs')).href,
        scale: dpi / 72,
      },
    )
    return pngs.map((base64, i) => {
      const path = `${prefix}-p${i + 1}.png`
      writeFileSync(path, Buffer.from(base64, 'base64'))
      return path
    })
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Workbook → PDF → PNG pages, all in `outDir`. */
export async function renderWorkbook(
  xlsxPath: string,
  outDir: string,
  dpi?: number,
): Promise<RenderedWorkbook> {
  mkdirSync(outDir, { recursive: true })
  const pdf = workbookToPdf(resolve(xlsxPath), outDir)
  const pages = await pdfToPngs(pdf, join(outDir, basename(xlsxPath, extname(xlsxPath))), dpi)
  return { pdf, pages }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const files: string[] = []
  let out = 'ui-look-out/xlsx'
  let dpi: number | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i]
    else if (argv[i] === '--dpi') dpi = Number(argv[++i])
    else files.push(argv[i])
  }
  if (files.length === 0)
    throw new Error('usage: xlsx.ts <file.xlsx> [...] --out <dir> [--dpi 110]')
  for (const file of files) {
    const { pdf, pages } = await renderWorkbook(file, resolve(out), dpi)
    console.log(pdf)
    for (const page of pages) console.log(page)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exit(1)
  })
}
