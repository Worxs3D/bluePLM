/**
 * `CommandConfirmContainer` is the final, blocking gate in front of any write a command handler
 * makes through `ctx.confirm()` (`executor.ts`'s `showCommandConfirm`). It can be opened by a
 * command from *any* calling context — the terminal, a right-click dialog, a settings dialog —
 * so it has to out-rank every one of them, unconditionally, or it renders invisibly underneath
 * whichever dialog happened to be open when the command ran.
 *
 * That is exactly what happened before this test existed: `ResolveMovedFilesDialog` (and several
 * siblings) render at `z-[70]`, above the confirm dialog's old `z-50`. Clicking "Run" there could
 * call `adopt-server-paths`, which calls `ctx.confirm()` — and the resulting dialog painted
 * behind `ResolveMovedFilesDialog`'s own backdrop, unreachable by mouse and with no visual sign
 * it existed. The button's spinner kept spinning forever; the only way out was to force-quit.
 * See `.cursor/plans/reconcile-hang-incident-report.md`.
 *
 * Rather than re-litigate every dialog's z-index by hand on every review, this test extracts the
 * confirm dialog's own z-index from its source and asserts no other `.tsx` file in `src/`
 * declares a **full-screen overlay** (`fixed inset-0`, the same shape every modal dialog in this
 * codebase uses) at or above it. A future dialog that reaches for `z-[500]` or higher to win some
 * other stacking fight will fail this test instead of silently reintroducing the same bug.
 *
 * Scoped to `fixed inset-0` on purpose: a handful of small, anchored popovers (a table cell's
 * inline "generate?" confirm, a dropdown menu) legitimately use a very high z-index to escape a
 * virtualized/`overflow` ancestor's stacking context. None of them cover the viewport, so none of
 * them can visually or pointer-wise hide the command confirmation dialog - only a competing
 * full-screen backdrop can, which is the shape of the bug this test exists to catch.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC_ROOT = join(__dirname, '..', '..', '..')
const CONTAINER_PATH = join(__dirname, 'CommandConfirmContainer.tsx')

/**
 * Matches Tailwind's arbitrary-value z-index (`z-[500]`) and the numbered scale (`z-50`).
 * The bracket form is not given a trailing `\b`: the closing `]` is a non-word character, and so
 * is whatever follows it (a quote, a space, end-of-string) - `\b` never matches between two
 * non-word characters, so requiring one there made the bracket form never match at all.
 */
const Z_INDEX_PATTERN = /\bz-\[(\d+)\]|\bz-(\d+)\b/g

/** Only a `className` string that also carries `fixed` and `inset-0` counts as a full-screen overlay. */
const FULL_SCREEN_CLASS_NAME = /className\s*=\s*(?:\{[^}]*?)?["'`]([^"'`]*)["'`]/g

function extractZIndexes(source: string): number[] {
  const values: number[] = []
  for (const match of source.matchAll(Z_INDEX_PATTERN)) {
    const value = match[1] ?? match[2]
    if (value !== undefined) values.push(Number(value))
  }
  return values
}

/** z-index values that appear inside a `className` also containing `fixed` and `inset-0`. */
function extractFullScreenOverlayZIndexes(source: string): number[] {
  const values: number[] = []
  for (const match of source.matchAll(FULL_SCREEN_CLASS_NAME)) {
    const classList = match[1]
    if (!classList.includes('fixed') || !classList.includes('inset-0')) continue
    values.push(...extractZIndexes(classList))
  }
  return values
}

function readOwnZIndex(): number {
  const source = readFileSync(CONTAINER_PATH, 'utf8')
  const values = extractZIndexes(source)
  if (values.length === 0) {
    throw new Error('CommandConfirmContainer.tsx no longer declares a z-index utility')
  }
  // The container declares exactly one z-index, on its own backdrop.
  return Math.max(...values)
}

/** Every `.tsx` file under `src/`, skipping `node_modules` and test files. */
function collectTsxFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const fullPath = join(dir, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      files.push(...collectTsxFiles(fullPath))
    } else if (entry.endsWith('.tsx') && !entry.includes('.test.')) {
      files.push(fullPath)
    }
  }
  return files
}

describe('CommandConfirmContainer always renders above every other dialog', () => {
  it('is not itself missing a z-index', () => {
    expect(readOwnZIndex()).toBeGreaterThan(0)
  })

  it('out-ranks every z-index used anywhere else in src/', () => {
    const ownZIndex = readOwnZIndex()
    const offenders: Array<{ file: string; value: number }> = []

    for (const file of collectTsxFiles(SRC_ROOT)) {
      if (file === CONTAINER_PATH) continue

      const source = readFileSync(file, 'utf8')
      for (const value of extractFullScreenOverlayZIndexes(source)) {
        if (value >= ownZIndex) {
          offenders.push({ file, value })
        }
      }
    }

    expect(
      offenders,
      offenders
        .map((o) => `${o.file.replace(SRC_ROOT, 'src')} declares z-${o.value} >= ${ownZIndex}`)
        .join('\n'),
    ).toEqual([])
  })
})
