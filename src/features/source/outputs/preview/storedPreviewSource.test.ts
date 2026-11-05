import { describe, expect, it } from 'vitest'

import type { VersionedOutput, VersionOutputKind } from '@/types/versionOutputs'

import { PREVIEW_MAX_BYTES } from './childPreviewModel'
import { pickStoredPreview, previewContentVersion, type StoredPreviewFile } from './storedPreviewSource'

function head(kind: VersionOutputKind, version: number, extra: Partial<VersionedOutput> = {}): VersionedOutput {
  return {
    id: `${kind}-${version}-${extra.configuration ?? ''}`,
    kind,
    fileId: 'f1',
    fileVersionId: `v${version}`,
    configuration: null,
    storageHash: `hash-${kind}-${version}`,
    fileSize: 1000,
    fileName: null,
    closureExact: true,
    generatedBy: null,
    generatedAt: '2026-11-01T00:00:00Z',
    version,
    ...extra,
  }
}

function file(extension: string, extra: Partial<StoredPreviewFile> = {}): StoredPreviewFile {
  return { extension, pdmData: { id: 'f1', version: 3 }, ...extra }
}

describe('previewContentVersion', () => {
  it('is the latest version for a file in sync or without a local copy', () => {
    expect(previewContentVersion(file('.slddrw'))).toBe(3)
    expect(previewContentVersion(file('.slddrw', { diffStatus: 'cloud' }))).toBe(3)
    expect(previewContentVersion(file('.slddrw', { diffStatus: 'moved' }))).toBe(3)
  })

  it('is the local version for an outdated copy, and nothing when it is not recorded', () => {
    expect(previewContentVersion(file('.slddrw', { diffStatus: 'outdated', localVersion: 2 }))).toBe(2)
    expect(previewContentVersion(file('.slddrw', { diffStatus: 'outdated' }))).toBeNull()
  })

  it('is nothing for content no checked-in version holds', () => {
    for (const diffStatus of ['added', 'modified', 'deleted', 'deleted_remote', 'ignored'] as const) {
      expect(previewContentVersion(file('.slddrw', { diffStatus }))).toBeNull()
    }
    expect(previewContentVersion({ extension: '.slddrw' })).toBeNull()
  })
})

describe('pickStoredPreview', () => {
  it("shows a drawing's PDF of the version on disk", () => {
    const pick = pickStoredPreview(file('.slddrw'), [head('pdf', 3), head('step', 3)])
    expect(pick?.kind).toEqual({ kind: 'pdf' })
    expect(pick?.output.storageHash).toBe('hash-pdf-3')
  })

  it('keeps the thumbnail when the PDF is of another version or the copy is edited', () => {
    expect(pickStoredPreview(file('.slddrw'), [head('pdf', 2)])).toBeNull()
    expect(pickStoredPreview(file('.slddrw', { diffStatus: 'modified' }), [head('pdf', 3)])).toBeNull()
    expect(pickStoredPreview(file('.slddrw', { diffStatus: 'outdated', localVersion: 2 }), [head('pdf', 3)])).toBeNull()
    expect(pickStoredPreview(file('.slddrw'), undefined)).toBeNull()
  })

  it('ignores outputs of another file', () => {
    expect(pickStoredPreview(file('.slddrw'), [head('pdf', 3, { fileId: 'other' })])).toBeNull()
  })

  it('prefers STL over STEP over IGES for a model, and never offers a PDF', () => {
    const all = [head('iges', 3), head('step', 3), head('stl', 3), head('pdf', 3)]
    expect(pickStoredPreview(file('.sldprt'), all)?.kind).toEqual({ kind: 'model', format: 'stl' })
    expect(pickStoredPreview(file('.sldasm'), [head('iges', 3), head('step', 3)])?.kind).toEqual({
      kind: 'model',
      format: 'step',
    })
    expect(pickStoredPreview(file('.sldprt'), [head('pdf', 3)])).toBeNull()
  })

  it('takes the asked configuration first, then the saved one', () => {
    const heads = [head('step', 3), head('step', 3, { configuration: 'Long', storageHash: 'long' })]
    expect(pickStoredPreview(file('.sldprt'), heads, 'Long')?.output.storageHash).toBe('long')
    expect(pickStoredPreview(file('.sldprt'), heads, 'Short')?.output.storageHash).toBe('hash-step-3')
    expect(pickStoredPreview(file('.sldprt'), heads)?.output.storageHash).toBe('hash-step-3')
  })

  it('skips a model export the 3D view would refuse as too large', () => {
    const big = head('stl', 3, { fileSize: PREVIEW_MAX_BYTES.model + 1 })
    expect(pickStoredPreview(file('.sldprt'), [big, head('step', 3)])?.kind).toEqual({ kind: 'model', format: 'step' })
    expect(pickStoredPreview(file('.sldprt'), [big])).toBeNull()
  })

  it('has nothing for folders and other file types', () => {
    expect(pickStoredPreview(file('.slddrw', { isDirectory: true }), [head('pdf', 3)])).toBeNull()
    expect(pickStoredPreview(file('.pdf'), [head('pdf', 3)])).toBeNull()
  })
})
