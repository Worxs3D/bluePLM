/**
 * `getSearchScore` normally ranks filename matches above everything else. The exception is an
 * item-number query - a run of six or more digits, like `100234` or `BR-100234` - where a match
 * on the item/part number should outrank a filename-only match, since the user is clearly
 * searching by number, not by name.
 */

import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/pdmStore'
import type { PDMFile } from '@/types/pdm'

import { runMigrations } from '@/stores/migrations'

import { filterBySearch, getSearchScore, looksLikeItemNumber, searchPool } from './filtering'

function localFile(
  name: string,
  overrides: { partNumber?: string } & Partial<LocalFile> = {},
): LocalFile {
  const { partNumber, ...rest } = overrides
  return {
    name,
    path: `C:\\vault\\${name}`,
    relativePath: name,
    isDirectory: false,
    extension: `.${name.split('.').pop()}`,
    size: 1,
    modifiedTime: 'now',
    ...(partNumber ? { pdmData: { part_number: partNumber } as PDMFile } : {}),
    ...rest,
  } as LocalFile
}

describe('looksLikeItemNumber', () => {
  it('matches a bare six-digit run', () => {
    expect(looksLikeItemNumber('100234')).toBe(true)
  })

  it('matches a six-digit run inside a prefixed number', () => {
    expect(looksLikeItemNumber('br-100234')).toBe(true)
  })

  it('does not match a plain name', () => {
    expect(looksLikeItemNumber('bracket')).toBe(false)
  })

  it('does not match a run shorter than six digits', () => {
    expect(looksLikeItemNumber('12345')).toBe(false)
  })
})

describe('getSearchScore - item-number queries', () => {
  it('ranks an item-number match above a filename-only match for a bare number', () => {
    const filenameHit = localFile('BR-100234-obsolete.sldprt', { partNumber: 'BR-999999' })
    const itemNumberHit = localFile('bracket.sldprt', { partNumber: 'BR-100234' })

    expect(getSearchScore(itemNumberHit, '100234')).toBeGreaterThan(
      getSearchScore(filenameHit, '100234'),
    )
  })

  it('ranks an item-number match above a filename-only match for a prefixed number', () => {
    const filenameHit = localFile('BR-100234-obsolete.sldprt', { partNumber: 'BR-999999' })
    const itemNumberHit = localFile('bracket.sldprt', { partNumber: 'BR-100234' })

    expect(getSearchScore(itemNumberHit, 'BR-100234')).toBeGreaterThan(
      getSearchScore(filenameHit, 'BR-100234'),
    )
  })
})

describe('getSearchScore - plain-name queries unchanged', () => {
  it('still ranks a filename match above an item-number match', () => {
    const filenameHit = localFile('bracket.sldprt', { partNumber: 'WIDGET-1' })
    const itemNumberHit = localFile('widget.sldprt', { partNumber: 'BRACKET-1' })

    expect(getSearchScore(filenameHit, 'bracket')).toBeGreaterThan(
      getSearchScore(itemNumberHit, 'bracket'),
    )
  })
})

describe('search "All" across the vault', () => {
  const vault = [
    localFile('bracket.sldprt', {
      relativePath: 'DEVELOPMENT/Thruster/bracket.sldprt',
      pdmData: { part_number: 'BR-102431', description: 'Motor Mount Bracket' } as PDMFile,
    }),
    localFile('cover.sldprt', {
      relativePath: '_ARCHIVE/cover.sldprt',
      pdmData: { part_number: 'BR-100001', description: 'Cover' } as PDMFile,
    }),
    localFile('notes.txt', { relativePath: 'DEVELOPMENT/notes.txt' }),
  ]
  const names = (files: LocalFile[]) => files.map((f) => f.name)

  it('matches item number and description case-insensitively', () => {
    expect(names(filterBySearch(vault, 'br-102431'))).toEqual(['bracket.sldprt'])
    expect(names(filterBySearch(vault, 'MOTOR MOUNT'))).toEqual(['bracket.sldprt'])
    expect(names(filterBySearch(vault, 'Notes'))).toEqual(['notes.txt'])
  })

  it('uses pending (unsaved) item numbers over committed ones', () => {
    const pending = localFile('pending.sldprt', {
      relativePath: 'DEVELOPMENT/pending.sldprt',
      pdmData: { part_number: null } as PDMFile,
      pendingMetadata: { part_number: 'BR-555555' },
    })
    expect(names(filterBySearch([pending], 'br-555555'))).toEqual(['pending.sldprt'])
  })

  it('searches every folder by default, whatever folder is open', () => {
    const pool = searchPool(vault, 'DEVELOPMENT/Thruster', 'all-folders')
    expect(names(filterBySearch(pool, 'BR-100001'))).toEqual(['cover.sldprt'])
  })

  it('current-folder scope keeps the folder and its subfolders, case- and separator-blind', () => {
    expect(names(searchPool(vault, 'development', 'current-folder'))).toEqual([
      'bracket.sldprt',
      'notes.txt',
    ])
    expect(names(searchPool(vault, 'DEVELOPMENT\\Thruster\\', 'current-folder'))).toEqual([
      'bracket.sldprt',
    ])
    expect(searchPool(vault, '', 'current-folder')).toBe(vault)
  })

  it('migrates the old current-folder default to the whole vault', () => {
    expect(runMigrations({ searchScope: 'current-folder' }, 12).searchScope).toBe('all-folders')
    expect(runMigrations({ searchScope: 'all-folders' }, 12).searchScope).toBe('all-folders')
  })
})
