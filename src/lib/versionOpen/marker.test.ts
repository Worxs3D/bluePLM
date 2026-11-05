import { describe, expect, it } from 'vitest'

import type { MergedClosure, PackageFile } from '@/lib/reviewPackage/types'

import {
  fileUnchanged,
  markerMatchesClosure,
  markerToJson,
  MARKER_FORMAT,
  parseMarker,
  previousHashesFromMarker,
} from './marker'
import type { CacheMarker } from './types'

const ROOT_ID = '11111111-1111-4111-8111-111111111111'

function pkg(id: string, path: string, hash: string): PackageFile {
  return {
    fileVersionId: id,
    fileId: `f-${id}`,
    filePath: path,
    fileName: path.split('/').pop()!,
    version: 1,
    revision: 'A',
    contentHash: hash,
    fileSize: 10,
    exact: true,
    isRoot: id === ROOT_ID,
    deleted: false,
  }
}

function closure(files: PackageFile[]): MergedClosure {
  return { files, missing: [], conflicts: [], exact: true, totalBytes: 0 }
}

function marker(extra: Partial<CacheMarker> = {}): CacheMarker {
  return {
    format: MARKER_FORMAT,
    formatVersion: 1,
    fileVersionId: ROOT_ID,
    rootPath: 'Top/asm.SLDASM',
    exact: true,
    approximate: false,
    stagedAt: '2026-11-04T00:00:00.000Z',
    files: [
      { path: 'Top/asm.SLDASM', fileVersionId: ROOT_ID, originalHash: 'h1', packagedHash: 'h1r', size: 5, modifiedTime: 't1' },
      { path: 'Parts/p.SLDPRT', fileVersionId: 'v2', originalHash: 'h2', packagedHash: null, size: 7, modifiedTime: 't2' },
    ],
    missing: 0,
    conflicts: 0,
    retargetFailed: 0,
    retargetMissing: 0,
    ...extra,
  }
}

describe('parseMarker', () => {
  it('round-trips a marker', () => {
    expect(parseMarker(markerToJson(marker()))).toEqual(marker())
  })

  it('refuses anything else', () => {
    expect(parseMarker(null)).toBeNull()
    expect(parseMarker('not json')).toBeNull()
    expect(parseMarker('{"format":"blueplm-review-package","formatVersion":1}')).toBeNull()
    expect(parseMarker(JSON.stringify({ ...marker(), formatVersion: 2 }))).toBeNull()
    expect(parseMarker(JSON.stringify({ ...marker(), files: [{ path: 1 }] }))).toBeNull()
  })
})

describe('markerMatchesClosure', () => {
  const files = [pkg(ROOT_ID, 'Top/asm.SLDASM', 'h1'), pkg('v2', 'Parts/p.SLDPRT', 'h2')]

  it('matches the same versions, content and paths, in any order', () => {
    expect(markerMatchesClosure(marker(), ROOT_ID, closure([...files].reverse()))).toBe(true)
  })

  it('does not match another version, other content, another path or another file set', () => {
    expect(markerMatchesClosure(marker(), 'other', closure(files))).toBe(false)
    expect(markerMatchesClosure(marker(), ROOT_ID, closure([files[0], pkg('v2', 'Parts/p.SLDPRT', 'h9')]))).toBe(false)
    expect(markerMatchesClosure(marker(), ROOT_ID, closure([files[0], pkg('v2', 'Other/p.SLDPRT', 'h2')]))).toBe(false)
    expect(markerMatchesClosure(marker(), ROOT_ID, closure([files[0]]))).toBe(false)
    expect(markerMatchesClosure(null, ROOT_ID, closure(files))).toBe(false)
  })
})

describe('previousHashesFromMarker', () => {
  it('maps path and original hash to the retargeted hash', () => {
    expect([...previousHashesFromMarker(marker())]).toEqual([['top/asm.sldasm|h1', 'h1r']])
    expect(previousHashesFromMarker(null).size).toBe(0)
  })
})

describe('fileUnchanged', () => {
  it('needs the recorded size and mtime of a file', () => {
    const rec = { size: 5, modifiedTime: 't1' }
    expect(fileUnchanged(rec, { success: true, size: 5, modifiedTime: 't1' })).toBe(true)
    expect(fileUnchanged(rec, { success: true, size: 6, modifiedTime: 't1' })).toBe(false)
    expect(fileUnchanged(rec, { success: true, size: 5, modifiedTime: 't9' })).toBe(false)
    expect(fileUnchanged(rec, { success: false })).toBe(false)
    expect(fileUnchanged(rec, { success: true, size: 5, modifiedTime: 't1', isDirectory: true })).toBe(false)
    expect(fileUnchanged({ size: 5, modifiedTime: null }, { success: true, size: 5 })).toBe(false)
  })
})
