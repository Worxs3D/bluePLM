/**
 * Generate inspection report workbooks exactly as a supplier receives them, then render them.
 *
 * Both built-in templates go through the real engine (`generateInspectionReport`) with the ui-look
 * fixture characteristics (src/perf/app/lookInspectionFixtures.ts), a sample logo and two sample
 * ballooned drawing sheets, plus one report with no characteristics. Each workbook is then rendered
 * page by page with scripts/ui-look/xlsx.ts.
 *
 *   npx tsx scripts/ui-look/xlsxFixtures.ts --out ui-look-out/xlsx [--dpi 110] [--no-render] [--types]
 *
 * `--types` generates the report-type workbooks instead (xlsxTypeFixtures.ts: AS9102 full and
 * partial FAI, production by columns and one row per part, receiving, re-inspection).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import sharp from 'sharp'

import {
  builtInTemplates,
  generateInspectionReport,
  type DrawingPageImage,
} from '../../src/lib/inspection/excel'
import { lookCharacteristics } from '../../src/perf/app/lookInspectionFixtures'

import { renderWorkbook } from './xlsx'
import { typeWorkbooks } from './xlsxTypeFixtures'

const SHEET_W = 1700
const SHEET_H = 1100
/** 2x: 3400 px across a 17 in sheet, 200 ppi, as `rasterizePdf` gives a real drawing. */
const RASTER = 2

/** Where each ballooned characteristic sits on its sheet (balloon number → x, y in sheet units). */
const BALLOONS: Record<number, Array<[number, number, number]>> = {
  1: [
    [1, 470, 180],
    [2, 760, 240],
    [3, 300, 430],
    [4, 610, 420],
    [5, 690, 360],
    [6, 960, 300],
    [7, 1010, 360],
    [8, 330, 700],
    [9, 520, 780],
    [10, 1180, 260],
    [11, 1250, 520],
    [12, 1300, 640],
    [13, 1420, 300],
    [14, 1460, 420],
    [15, 820, 640],
    [16, 700, 120],
    [17, 1040, 720],
  ],
  2: [
    [18, 420, 300],
    [19, 600, 260],
    [20, 1050, 330],
    [21, 1210, 430],
    [22, 820, 800],
  ],
}

function balloon(n: number, x: number, y: number, tx: number, ty: number): string {
  return `<line x1="${x}" y1="${y}" x2="${tx}" y2="${ty}" stroke="#1b1b1b" stroke-width="1.2"/>
<circle cx="${tx}" cy="${ty}" r="3" fill="#1b1b1b"/>
<circle cx="${x}" cy="${y}" r="17" fill="#fff" stroke="#1b1b1b" stroke-width="1.6"/>
<text x="${x}" y="${y + 6}" font-size="17" font-family="Arial" text-anchor="middle" fill="#1b1b1b">${n}</text>`
}

function titleBlock(sheet: number): string {
  const x = 1100
  const y = 900
  return `<g font-family="Arial" fill="#1b1b1b">
<rect x="${x}" y="${y}" width="560" height="160" fill="none" stroke="#1b1b1b" stroke-width="2"/>
<line x1="${x}" y1="${y + 50}" x2="${x + 560}" y2="${y + 50}" stroke="#1b1b1b"/>
<line x1="${x}" y1="${y + 110}" x2="${x + 560}" y2="${y + 110}" stroke="#1b1b1b"/>
<line x1="${x + 380}" y1="${y + 50}" x2="${x + 380}" y2="${y + 160}" stroke="#1b1b1b"/>
<text x="${x + 12}" y="${y + 33}" font-size="22" font-weight="bold">BRACKET, MOTOR MOUNT</text>
<text x="${x + 12}" y="${y + 72}" font-size="11">DWG NO.</text><text x="${x + 12}" y="${y + 98}" font-size="22">BR-103849-201</text>
<text x="${x + 392}" y="${y + 72}" font-size="11">REV</text><text x="${x + 392}" y="${y + 98}" font-size="22">B</text>
<text x="${x + 12}" y="${y + 130}" font-size="11">UNLESS OTHERWISE SPECIFIED: X.X ±0.5  X.XX ±0.2  ANGLES ±0.5°</text>
<text x="${x + 12}" y="${y + 150}" font-size="11">MATERIAL 6061-T6  FINISH: ANODIZE BLACK</text>
<text x="${x + 392}" y="${y + 140}" font-size="16">SHEET ${sheet} OF 2</text>
</g>`
}

function sheetSvg(sheet: 1 | 2): string {
  const views =
    sheet === 1
      ? `<rect x="250" y="200" width="520" height="420" fill="none" stroke="#1b1b1b" stroke-width="2.5"/>
<circle cx="510" cy="410" r="70" fill="none" stroke="#1b1b1b" stroke-width="2.5"/>
${[
  [330, 280],
  [690, 280],
  [330, 540],
  [690, 540],
]
  .map(
    ([cx, cy]) =>
      `<circle cx="${cx}" cy="${cy}" r="14" fill="none" stroke="#1b1b1b" stroke-width="2"/>`,
  )
  .join('')}
<line x1="250" y1="160" x2="770" y2="160" stroke="#1b1b1b"/><text x="510" y="152" font-size="16" font-family="Arial" text-anchor="middle">120.00 ±0.10</text>
<line x1="210" y1="200" x2="210" y2="620" stroke="#1b1b1b"/><text x="200" y="415" font-size="16" font-family="Arial" text-anchor="end">64.50 ±0.05</text>
<rect x="900" y="200" width="160" height="420" fill="none" stroke="#1b1b1b" stroke-width="2.5"/>
<rect x="1180" y="360" width="440" height="160" fill="none" stroke="#1b1b1b" stroke-width="2.5"/>
<text x="1400" y="570" font-size="16" font-family="Arial" text-anchor="middle">SECTION A-A</text>
<rect x="280" y="720" width="360" height="120" fill="none" stroke="#1b1b1b" stroke-width="2.5"/>`
      : `<rect x="300" y="200" width="460" height="320" fill="none" stroke="#1b1b1b" stroke-width="2.5"/>
<circle cx="530" cy="360" r="120" fill="none" stroke="#1b1b1b" stroke-width="2" stroke-dasharray="10 6"/>
<text x="530" y="560" font-size="16" font-family="Arial" text-anchor="middle">DETAIL B (2 : 1)</text>
<rect x="940" y="240" width="420" height="300" fill="none" stroke="#1b1b1b" stroke-width="2.5"/>
<text x="560" y="760" font-size="15" font-family="Arial">NOTES: 1. ANODIZE PER MIL-A-8625 TYPE II, CLASS 2, BLACK.</text>`
  const balloons = BALLOONS[sheet]
    .map(([n, x, y]) => balloon(n, x, y, x + (x < 850 ? 45 : -45), y + 35))
    .join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W * RASTER}" height="${SHEET_H * RASTER}" viewBox="0 0 ${SHEET_W} ${SHEET_H}">
<rect width="${SHEET_W}" height="${SHEET_H}" fill="#fff"/>
<rect x="20" y="20" width="${SHEET_W - 40}" height="${SHEET_H - 40}" fill="none" stroke="#1b1b1b" stroke-width="3"/>
${views}
${balloons}
${titleBlock(sheet)}
</svg>`
}

async function png(svg: string): Promise<{ png: Uint8Array; widthPx: number; heightPx: number }> {
  const { data, info } = await sharp(Buffer.from(svg)).png().toBuffer({ resolveWithObject: true })
  return { png: new Uint8Array(data), widthPx: info.width, heightPx: info.height }
}

/** A plain wordmark standing in for an organization's logo (wide, as most are). */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="200" viewBox="0 0 360 100">
<rect width="360" height="100" fill="#fff"/>
<path d="M20 70 L50 20 L80 70 Z" fill="#1f6feb"/><circle cx="50" cy="58" r="10" fill="#fff"/>
<text x="100" y="62" font-family="Arial" font-size="40" font-weight="bold" fill="#0b2545">Northwind</text>
<text x="102" y="84" font-family="Arial" font-size="14" fill="#5c6b7a">ROBOTICS</text>
</svg>`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  let out = 'ui-look-out/xlsx'
  let dpi: number | undefined
  let render = true
  let types = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i]
    else if (argv[i] === '--dpi') dpi = Number(argv[++i])
    else if (argv[i] === '--no-render') render = false
    else if (argv[i] === '--types') types = true
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  out = resolve(out)
  mkdirSync(out, { recursive: true })

  const pages: DrawingPageImage[] = [await png(sheetSvg(1)), await png(sheetSvg(2))]
  writeFileSync(join(out, 'drawing-sheet-1.png'), pages[0].png)
  const logo = { bytes: (await png(LOGO_SVG)).png, extension: 'png' as const }
  const rows = lookCharacteristics().map((row, i) => ({ ...row, id: `row-${i + 1}` }))
  const scalars = {
    PART_NUMBER: 'BR-103849-201',
    PART_NAME: 'Bracket, motor mount',
    DESCRIPTION: 'Bracket, motor mount, 6061-T6',
    REVISION: 'B',
    DRAWING_NAME: 'BR-103849-201.SLDDRW',
    DRAWING_VERSION: '3',
    REPORT_NUMBER: 'BR-103849-201_RevB_IRv5',
    ORG_NAME: 'Northwind Robotics',
    GENERAL_TOLERANCES: 'X.X ±0.5, X.XX ±0.2, angles ±0.5°',
  }
  const generatedAt = new Date('2026-11-03T10:00:00Z')

  const workbooks: string[] = types ? await typeWorkbooks(out, rows, pages, logo, scalars, generatedAt) : []
  for (const template of types ? [] : await builtInTemplates()) {
    const common = {
      template: template.bytes,
      fileId: 'look-file',
      fileVersionId: 'look-version-3',
      scalars,
      logo,
      generatedAt,
    }
    const full = join(out, `${template.key}.xlsx`)
    writeFileSync(
      full,
      await generateInspectionReport({
        ...common,
        reportId: `look-${template.key}`,
        rows,
        drawingPages: pages,
      }),
    )
    workbooks.push(full)
    if (template.key === 'dimensional-inspection') {
      // A table that fits its first page: no title rows repeat over the drawing pages.
      const short = join(out, `${template.key}-short.xlsx`)
      writeFileSync(
        short,
        await generateInspectionReport({
          ...common,
          reportId: 'look-short',
          rows: rows.slice(0, 10),
          drawingPages: pages,
        }),
      )
      workbooks.push(short)
      const empty = join(out, `${template.key}-no-rows.xlsx`)
      writeFileSync(
        empty,
        await generateInspectionReport({ ...common, reportId: 'look-empty', rows: [], logo: null }),
      )
      workbooks.push(empty)
    }
  }

  for (const workbook of workbooks) {
    console.log(workbook)
    if (!render) continue
    const { pdf, pages: pngs } = await renderWorkbook(workbook, out, dpi)
    console.log(pdf)
    for (const page of pngs) console.log(page)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})
