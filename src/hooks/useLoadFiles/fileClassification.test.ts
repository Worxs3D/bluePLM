import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'
import {
  MODIFIED_TOLERANCE_MS,
  classifyAgainstServerRow,
  classifyWithComputedHash,
  classifyWithoutServerRow,
  resolveLocalHash,
  selectFilesNeedingHash,
} from './fileClassification'

const UPDATED_AT = '2026-10-20T10:00:00.000Z'
const UPDATED_MS = Date.parse(UPDATED_AT)
const at = (ms: number) => new Date(ms).toISOString()

const row = { content_hash: 'h2', updated_at: UPDATED_AT, version: 2, checked_out_by: 'me' }
const base = {
  row,
  moved: false,
  localHash: undefined,
  modifiedTime: UPDATED_AT,
  localVersion: 2,
  userId: 'me',
  hasPendingMetadata: false,
}

describe('classifyAgainstServerRow', () => {
  it('needs more than the tolerance before a checked-out file without a hash counts as edited', () => {
    expect(
      classifyAgainstServerRow({ ...base, modifiedTime: at(UPDATED_MS + MODIFIED_TOLERANCE_MS) })
        .diffStatus,
    ).toBeUndefined()
    expect(
      classifyAgainstServerRow({ ...base, modifiedTime: at(UPDATED_MS + MODIFIED_TOLERANCE_MS + 1) })
        .diffStatus,
    ).toBe('modified')
  })

  it('never calls a file someone else holds modified from its timestamp alone', () => {
    const result = classifyAgainstServerRow({
      ...base,
      row: { ...row, checked_out_by: 'other' },
      modifiedTime: at(UPDATED_MS + 60_000),
    })
    expect(result.diffStatus).toBeUndefined()
  })

  it('calls an edit of a held file modified even when a later server write bumped updated_at', () => {
    const older = at(UPDATED_MS - 60_000)
    expect(
      classifyAgainstServerRow({ ...base, localHash: 'mine', modifiedTime: older }).diffStatus,
    ).toBe('modified')
    // Behind the server's version is outdated whoever holds it, and so is a file nobody holds.
    expect(
      classifyAgainstServerRow({ ...base, localHash: 'mine', modifiedTime: older, localVersion: 1 })
        .diffStatus,
    ).toBe('outdated')
    expect(
      classifyAgainstServerRow({
        ...base,
        row: { ...row, checked_out_by: null },
        localHash: 'mine',
        modifiedTime: older,
      }).diffStatus,
    ).toBe('outdated')
  })

  it('lets pending metadata win over a matching hash and over a move', () => {
    expect(
      classifyAgainstServerRow({ ...base, localHash: 'h2', hasPendingMetadata: true }).diffStatus,
    ).toBe('modified')
    expect(
      classifyAgainstServerRow({ ...base, moved: true, hasPendingMetadata: true }).diffStatus,
    ).toBe('modified')
  })

  it('stamps the server version only on a verified match, and never lowers a tracked one', () => {
    expect(classifyAgainstServerRow({ ...base, localVersion: undefined }).localVersion).toBe(
      undefined,
    )
    expect(
      classifyAgainstServerRow({ ...base, localVersion: undefined, localHash: 'h2' }).localVersion,
    ).toBe(2)
    expect(classifyAgainstServerRow({ ...base, localVersion: 5, localHash: 'h2' }).localVersion).toBe(
      5,
    )
  })
})

describe('classifyWithoutServerRow', () => {
  it('treats an unreadable modified time on an orphan as possibly edited', () => {
    expect(
      classifyWithoutServerRow({
        ignored: false,
        syncIndexEntry: { orphanedAt: UPDATED_MS },
        modifiedTime: 'not a date',
      }),
    ).toEqual({ diffStatus: 'deleted_remote', editedSinceOrphaned: true })
  })

  it('prefers ignored over orphaned', () => {
    expect(
      classifyWithoutServerRow({ ignored: true, syncIndexEntry: {}, modifiedTime: UPDATED_AT })
        .diffStatus,
    ).toBe('ignored')
  })
})

describe('resolveLocalHash', () => {
  const file = { size: 10, modifiedTime: UPDATED_AT }
  it('uses the scan hash over any cached one', () => {
    expect(resolveLocalHash('scan', 'cached', undefined, file)).toEqual({
      localHash: 'scan',
      rehash: false,
    })
  })
  it('drops a stale hash and keeps an unverified one, re-hashing both', () => {
    expect(resolveLocalHash(undefined, 'cached', { size: 9, mtimeMs: UPDATED_MS }, file)).toEqual({
      localHash: undefined,
      rehash: true,
    })
    expect(resolveLocalHash(undefined, 'cached', undefined, file)).toEqual({
      localHash: 'cached',
      rehash: true,
    })
  })
})

function localFile(overrides: Partial<LocalFile> = {}): LocalFile {
  return {
    name: 'a.sldprt',
    path: 'C:/v/a.sldprt',
    relativePath: 'a.sldprt',
    isDirectory: false,
    extension: '.sldprt',
    size: 10,
    modifiedTime: UPDATED_AT,
    pdmData: { ...row, file_path: 'a.sldprt' } as unknown as PDMFile,
    ...overrides,
  }
}

describe('selectFilesNeedingHash', () => {
  it('re-hashes a file whose kept hash is unverified', () => {
    const file = localFile({ localHash: 'h2', localVersion: 2 })
    expect(selectFilesNeedingHash([file], new Set(['a.sldprt']), false)).toEqual([file])
    expect(selectFilesNeedingHash([file], new Set(), false)).toEqual([])
  })

  it('hashes a file seen for the first time', () => {
    const file = localFile()
    expect(selectFilesNeedingHash([file], new Set(), false)).toEqual([file])
  })
})

describe('classifyWithComputedHash', () => {
  it('keeps the hash but not a status on a file with no server hash', () => {
    const file = localFile({ pdmData: undefined, diffStatus: 'added' })
    expect(
      classifyWithComputedHash(file, 'h', { size: 10, mtimeMs: UPDATED_MS }, 'me'),
    ).toEqual({ ...file, localHash: 'h' })
  })
})
