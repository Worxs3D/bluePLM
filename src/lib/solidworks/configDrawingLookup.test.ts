/**
 * `collectCandidateDrawings` builds the set of drawings worth checking for a model's
 * configuration, from database rows and local siblings. A `'moved_away'` stub carries the
 * real drawing's `pdmData` but has no file behind it at its own (server-recorded) path - its
 * `'moved'` partner holds the content at `movedToRelativePath`. These tests cover the
 * resolution that prefers the partner with real content over the stub, and the exclusion of
 * bare stubs from the local-sibling scan. See
 * `.cursor/plans/realign-4.4.0-foldin-report.md` for the full investigation.
 */

import { describe, expect, it } from 'vitest'

import type { DrawingRefItem } from '@/lib/supabase/files/queries'
import type { LocalFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'

import { collectCandidateDrawings } from './configDrawingLookup'

const VAULT = 'C:\\vault'

function localFile(relativePath: string, overrides: Partial<LocalFile> = {}): LocalFile {
  return {
    name: relativePath.split(/[/\\]/).pop() || '',
    path: `${VAULT}\\${relativePath.replace(/\//g, '\\')}`,
    relativePath,
    isDirectory: false,
    extension: relativePath.toLowerCase().endsWith('.slddrw') ? '.slddrw' : '.sldasm',
    size: 1,
    modifiedTime: 'now',
    ...overrides,
  }
}

function dbItem(overrides: Partial<DrawingRefItem> = {}): DrawingRefItem {
  return {
    id: 'ref-1',
    file_id: 'drawing-1',
    file_name: 'DRAWING-1.SLDDRW',
    file_path: 'Parts/OLD-LOCATION/DRAWING-1.SLDDRW',
    file_type: 'drawing',
    part_number: null,
    description: null,
    revision: null,
    state: null,
    configuration: null,
    in_database: true,
    ...overrides,
  }
}

/**
 * A `moved_away` stub at the drawing's server-recorded path plus its `'moved'` partner at
 * the path the content actually lives - the shape `cloudFileReconciliation.ts` produces for
 * an unreconciled inode-matched rename.
 */
function movedAwayPair(oldPath: string, newPath: string): { stub: LocalFile; moved: LocalFile } {
  const pdmData = {
    id: 'drawing-1',
    file_path: oldPath,
    checked_out_by: null,
  } as PDMFile

  return {
    stub: localFile(oldPath, {
      diffStatus: 'moved_away',
      movedToRelativePath: newPath,
      pdmData,
    }),
    moved: localFile(newPath, {
      diffStatus: 'moved',
      pdmData,
    }),
  }
}

describe('collectCandidateDrawings / moved_away stubs', () => {
  it('resolves a database row to the moved partner that actually has content, not the stub', () => {
    const model = localFile('Parts/OLD-LOCATION/MODEL.SLDASM')
    const { stub, moved } = movedAwayPair(
      'Parts/OLD-LOCATION/DRAWING-1.SLDDRW',
      'Parts/NEW-LOCATION/DRAWING-1.SLDDRW',
    )
    const files = [model, stub, moved]
    const dbItems = [dbItem({ file_path: stub.relativePath })]

    const candidates = collectCandidateDrawings(model, files, dbItems)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].path).toBe(moved.path)
    expect(candidates[0].path).not.toBe(stub.path)
    expect(candidates[0].fileId).toBe('drawing-1')
  })

  it('does not add a bare moved_away stub as a local-sibling candidate', () => {
    // The model sits in the drawing's OLD folder; the drawing itself moved elsewhere, so the
    // only trace left in that folder is the stub, which has no content behind it.
    const model = localFile('Parts/OLD-LOCATION/MODEL.SLDASM')
    const { stub } = movedAwayPair(
      'Parts/OLD-LOCATION/DRAWING-1.SLDDRW',
      'Parts/NEW-LOCATION/DRAWING-1.SLDDRW',
    )
    const files = [model, stub]

    const candidates = collectCandidateDrawings(model, files, [])

    expect(candidates).toHaveLength(0)
  })

  it('still finds a real local-sibling drawing that is not a moved_away stub', () => {
    const model = localFile('Parts/LOCATION/MODEL.SLDASM')
    const drawing = localFile('Parts/LOCATION/DRAWING-1.SLDDRW', {
      pdmData: { id: 'drawing-1', file_path: 'Parts/LOCATION/DRAWING-1.SLDDRW' } as PDMFile,
    })
    const files = [model, drawing]

    const candidates = collectCandidateDrawings(model, files, [])

    expect(candidates).toHaveLength(1)
    expect(candidates[0].path).toBe(drawing.path)
    expect(candidates[0].fileId).toBe('drawing-1')
  })
})
