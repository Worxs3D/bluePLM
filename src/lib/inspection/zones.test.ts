import { describe, expect, it } from 'vitest'

import { inferZoneGrid, zoneAt } from './zones'
import type { ExtractedDrawingSheet, ExtractedSheetNote } from './types'

/** ISO A3 landscape: 8 zone columns, 6 zone rows. */
const A3: ExtractedDrawingSheet = { name: 'Sheet1', widthM: 0.42, heightM: 0.297 }
const COL_W = 0.42 / 8
const ROW_H = 0.297 / 6

function note(text: string, x: number, y: number): ExtractedSheetNote {
  return { text, x, y, height: 0.0035, source: 'format' }
}

interface BorderOptions {
  /** Letters start at the bottom (A lowest) or at the top. */
  lettersFrom: 'bottom' | 'top'
  /** Numbers start at the left (1 leftmost) or at the right. */
  numbersFrom: 'left' | 'right'
  edges?: 'both' | 'one'
}

function border({ lettersFrom, numbersFrom, edges = 'both' }: BorderOptions): ExtractedSheetNote[] {
  const notes: ExtractedSheetNote[] = []
  for (let i = 0; i < 8; i++) {
    const label = String(numbersFrom === 'left' ? i + 1 : 8 - i)
    const x = (i + 0.5) * COL_W
    notes.push(note(label, x, 0.005))
    if (edges === 'both') notes.push(note(label, x, 0.292))
  }
  const letters = 'ABCDEF'
  for (let j = 0; j < 6; j++) {
    const label = lettersFrom === 'bottom' ? letters[j] : letters[5 - j]
    const y = (j + 0.5) * ROW_H
    notes.push(note(label, 0.005, y))
    if (edges === 'both') notes.push(note(label, 0.415, y))
  }
  return notes
}

describe('inferZoneGrid', () => {
  it('reads letters bottom to top and numbers left to right', () => {
    const grid = inferZoneGrid(A3, border({ lettersFrom: 'bottom', numbersFrom: 'left' }))
    expect(grid?.rows.map((r) => r.label)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
    expect(grid?.columns.map((c) => c.label)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(grid && zoneAt(grid, 0.08, 0.03)).toBe('A2')
    expect(grid && zoneAt(grid, 0.41, 0.29)).toBe('F8')
  })

  it('reads letters top to bottom and numbers right to left (ASME layout)', () => {
    const grid = inferZoneGrid(A3, border({ lettersFrom: 'top', numbersFrom: 'right' }))
    expect(grid).not.toBeNull()
    // Top left corner of the drawing area: first letter, highest number.
    expect(zoneAt(grid!, 0.02, 0.28)).toBe('A8')
    // Bottom right: last letter, number 1.
    expect(zoneAt(grid!, 0.4, 0.02)).toBe('F1')
  })

  it('works with labels on one horizontal and one vertical edge only', () => {
    const grid = inferZoneGrid(A3, border({ lettersFrom: 'bottom', numbersFrom: 'left', edges: 'one' }))
    expect(grid && zoneAt(grid, 0.2, 0.15)).toBe('D4')
  })

  it('puts zone boundaries midway between label centres', () => {
    const grid = inferZoneGrid(A3, border({ lettersFrom: 'bottom', numbersFrom: 'left' }))!
    expect(zoneAt(grid, 2 * COL_W - 0.001, ROW_H - 0.001)).toBe('A2')
    expect(zoneAt(grid, 2 * COL_W + 0.001, ROW_H + 0.001)).toBe('B3')
  })

  it('ignores a stray title block value on an edge by using the other edge', () => {
    const notes = [...border({ lettersFrom: 'bottom', numbersFrom: 'left' }), note('1', 0.35, 0.008)]
    const grid = inferZoneGrid(A3, notes)
    expect(grid?.columns).toHaveLength(8)
    expect(grid && zoneAt(grid, 0.08, 0.03)).toBe('A2')
  })

  it('ignores labels away from the edges and in the corners', () => {
    const notes = [
      ...border({ lettersFrom: 'bottom', numbersFrom: 'left', edges: 'one' }),
      note('Z', 0.2, 0.15),
      note('9', 0.2, 0.15),
      note('Q', 0.004, 0.004),
    ]
    const grid = inferZoneGrid(A3, notes)
    expect(grid?.rows.map((r) => r.label)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  it('returns null when one axis is missing', () => {
    const lettersOnly = border({ lettersFrom: 'bottom', numbersFrom: 'left' }).filter((n) => /[A-Z]/.test(n.text))
    expect(inferZoneGrid(A3, lettersOnly)).toBeNull()
  })

  it('needs at least three labels per axis', () => {
    const notes = [
      note('1', 0.03, 0.005),
      note('2', 0.08, 0.005),
      note('A', 0.005, 0.03),
      note('B', 0.005, 0.08),
      note('C', 0.005, 0.13),
    ]
    expect(inferZoneGrid(A3, notes)).toBeNull()
  })

  it('needs evenly spaced labels (a missing label or a stray value breaks the run)', () => {
    const uneven = border({ lettersFrom: 'bottom', numbersFrom: 'left', edges: 'one' }).filter((n) => n.text !== '5')
    expect(inferZoneGrid(A3, uneven)).toBeNull()
  })

  it('returns null when the labels are not in sequence', () => {
    const notes = [
      note('1', 0.03, 0.005),
      note('3', 0.08, 0.005),
      note('2', 0.13, 0.005),
      note('A', 0.005, 0.03),
      note('B', 0.005, 0.08),
    ]
    expect(inferZoneGrid(A3, notes)).toBeNull()
  })

  it('returns null without notes or a sheet size', () => {
    expect(inferZoneGrid(A3, undefined)).toBeNull()
    expect(inferZoneGrid(A3, [])).toBeNull()
    expect(
      inferZoneGrid({ ...A3, widthM: 0 }, border({ lettersFrom: 'bottom', numbersFrom: 'left' })),
    ).toBeNull()
  })
})
