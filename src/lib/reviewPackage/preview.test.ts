/**
 * `resolveReviewItemPreview` shows the version a round reviewed, so an earlier round's markups are
 * drawn on the PDF they were made on. Only the routing is tested here: which version's PDF is
 * looked up. Downloading is covered by the cache's own checks.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DrawingPdf, ReviewItemDetail } from '@/types/reviews'

const getDrawingPdf = vi.fn<(id: string) => Promise<DrawingPdf | null>>()
const getFileVersionContentHash = vi.fn<(id: string) => Promise<string | null>>()

vi.mock('@/lib/supabase/reviews', () => ({
  getDrawingPdf: (id: string) => getDrawingPdf(id),
  getFileVersionContentHash: (id: string) => getFileVersionContentHash(id),
  recordDrawingPdf: vi.fn(),
  ReviewRpcError: class extends Error {},
}))

import { resolveReviewItemPreview } from './pdf'

function item(fileName: string, pdf: DrawingPdf | null = null): ReviewItemDetail {
  return {
    id: 'item-1',
    fileId: 'file-1',
    vaultId: null,
    sortOrder: 0,
    outcome: 'pending',
    addedInRound: 1,
    file: {
      fileName,
      filePath: `A/${fileName}`,
      extension: null,
      partNumber: null,
      description: null,
      latestVersion: 3,
      deleted: false,
    },
    version: {
      fileVersionId: 'v3',
      version: 3,
      revision: null,
      contentHash: 'a'.repeat(64),
      fileSize: 1,
      state: null,
      createdAt: null,
      createdBy: null,
      referencesRecorded: true,
    },
    pdf,
    rounds: [],
  }
}

const storedPdf: DrawingPdf = {
  fileVersionId: 'v3',
  fileId: 'file-1',
  storageHash: 'b'.repeat(64),
  fileSize: 1,
  closureExact: true,
  generatedBy: null,
  generatedAt: '2026-10-28T00:00:00Z',
}

describe('resolveReviewItemPreview', () => {
  beforeEach(() => {
    getDrawingPdf.mockReset()
    getFileVersionContentHash.mockReset()
  })

  it('looks up the render of the earlier version a round reviewed, not the pinned one', async () => {
    getDrawingPdf.mockResolvedValue(null)
    const result = await resolveReviewItemPreview(item('X.SLDDRW', storedPdf), 'v1')
    expect(getDrawingPdf).toHaveBeenCalledWith('v1')
    expect(result).toEqual({ kind: 'pdf_pending' })
  })

  it('reads an earlier PDF version hash from the server, and reports a vanished one', async () => {
    getFileVersionContentHash.mockResolvedValue(null)
    const result = await resolveReviewItemPreview(item('X.pdf'), 'v1')
    expect(getFileVersionContentHash).toHaveBeenCalledWith('v1')
    expect(result).toEqual({ kind: 'unsupported' })
  })

  it('defaults to the pinned version and its known render', async () => {
    getDrawingPdf.mockResolvedValue(null)
    const result = await resolveReviewItemPreview(item('X.SLDDRW'))
    expect(getDrawingPdf).toHaveBeenCalledWith('v3')
    expect(result).toEqual({ kind: 'pdf_pending' })
  })
})
