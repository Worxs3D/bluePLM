/**
 * Drawing zones from the sheet border: the zone letters run along a vertical edge and the zone
 * numbers along a horizontal edge (ASME Y14.1, ISO 5457). The grid is read from where the
 * labels actually sit, so letters may run bottom-to-top or top-to-bottom and numbers left-to-right
 * or right-to-left. Used only when the service gives no zone. Pure.
 */
import type { ExtractedDrawingSheet, ExtractedSheetNote } from './types'

export interface ZoneAxisLabel {
  label: string
  /** Label position along its axis, sheet metres (y for letters, x for numbers). */
  center: number
}

export interface ZoneGrid {
  /** Letters, along y. */
  rows: ZoneAxisLabel[]
  /** Numbers, along x. */
  columns: ZoneAxisLabel[]
}

/**
 * How far from the sheet edge a border label may sit: 4% of the shorter side, kept between 6 mm
 * and 20 mm. Border margins are 10-20 mm on standard sheets and the labels sit inside the margin,
 * while title block values sit further in.
 */
function edgeBand(sheet: ExtractedDrawingSheet): number {
  return Math.min(0.02, Math.max(0.006, 0.04 * Math.min(sheet.widthM, sheet.heightM)))
}

interface Candidate {
  label: string
  /** Rank used to check the run is in sequence (letter index or number value). */
  rank: number
  /** Position along the edge. */
  along: number
}

/** Fewest labels accepted as a zone run along one edge. */
const MIN_RUN_LABELS = 3
/** Each spacing between neighbouring labels must be within this fraction of the median spacing. */
const SPACING_TOLERANCE = 0.25

/**
 * The labels on one edge, when they form a zone run: at least three, no label twice, in strict
 * sequence (ascending or descending) along the edge, and evenly spaced (zones are equal divisions
 * of the border, ISO 5457 / ASME Y14.1). Otherwise null.
 */
function validRun(candidates: Candidate[]): ZoneAxisLabel[] | null {
  if (candidates.length < MIN_RUN_LABELS) return null
  if (new Set(candidates.map((c) => c.label)).size !== candidates.length) return null
  const sorted = [...candidates].sort((a, b) => a.along - b.along)
  const ascending = sorted[1].rank > sorted[0].rank
  for (let i = 1; i < sorted.length; i++) {
    const step = sorted[i].rank - sorted[i - 1].rank
    if (step === 0 || step > 0 !== ascending) return null
  }
  const gaps = sorted.slice(1).map((c, i) => c.along - sorted[i].along)
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
  if (!(median > 0)) return null
  if (gaps.some((g) => Math.abs(g - median) > SPACING_TOLERANCE * median)) return null
  return sorted.map((c) => ({ label: c.label, center: c.along }))
}

/** The longer valid run of two opposite edges; the first one on a tie. */
function bestRun(a: Candidate[], b: Candidate[]): ZoneAxisLabel[] | null {
  const ra = validRun(a)
  const rb = validRun(b)
  if (ra && rb) return rb.length > ra.length ? rb : ra
  return ra ?? rb
}

/** The zone grid of a sheet from its border labels, or null when the notes do not show one. */
export function inferZoneGrid(
  sheet: ExtractedDrawingSheet,
  notes: readonly ExtractedSheetNote[] | null | undefined,
): ZoneGrid | null {
  if (!notes || notes.length === 0) return null
  const { widthM: w, heightM: h } = sheet
  if (!(w > 0) || !(h > 0)) return null
  const band = edgeBand(sheet)

  const left: Candidate[] = []
  const right: Candidate[] = []
  const bottom: Candidate[] = []
  const top: Candidate[] = []
  for (const note of notes) {
    const text = note.text.trim().toUpperCase()
    const nearLeft = note.x < band
    const nearRight = note.x > w - band
    const nearBottom = note.y < band
    const nearTop = note.y > h - band
    // Corners belong to neither run.
    if ((nearLeft || nearRight) && (nearBottom || nearTop)) continue
    if (/^[A-Z]$/.test(text)) {
      const c = { label: text, rank: text.charCodeAt(0), along: note.y }
      if (nearLeft) left.push(c)
      else if (nearRight) right.push(c)
    } else if (/^\d{1,2}$/.test(text) && Number(text) > 0) {
      const c = { label: String(Number(text)), rank: Number(text), along: note.x }
      if (nearBottom) bottom.push(c)
      else if (nearTop) top.push(c)
    }
  }

  const rows = bestRun(left, right)
  const columns = bestRun(bottom, top)
  if (!rows || !columns) return null
  return { rows, columns }
}

function nearest(labels: ZoneAxisLabel[], v: number): string {
  let best = labels[0]
  for (const l of labels) if (Math.abs(l.center - v) < Math.abs(best.center - v)) best = l
  return best.label
}

/**
 * The zone of a point: the nearest letter along y and the nearest number along x (so zone
 * boundaries fall midway between label centres), written letter first (`B3`).
 */
export function zoneAt(grid: ZoneGrid, x: number, y: number): string {
  return `${nearest(grid.rows, y)}${nearest(grid.columns, x)}`
}
