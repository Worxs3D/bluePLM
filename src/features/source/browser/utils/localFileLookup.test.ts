/**
 * `findLocalFileByPath` matches purely on path - exact, path-ending, then filename. A
 * `'moved_away'` stub sits at exactly the path the database still records for a file whose
 * content now lives elsewhere on disk, so the exact-path strategy used to *prefer* the stub
 * over its `'moved'` partner whenever a caller resolved a component's database-recorded (and
 * now stale) path - not merely reachable by accident, but the first match in the common case.
 *
 * See `.cursor/plans/stub-aware-lookup-audit-report.md` for the full caller audit this covers.
 */

import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/pdmStore'

import { findLocalFileByPath } from './localFileLookup'

const VAULT = 'C:\\vault'

function localFile(relativePath: string, overrides: Partial<LocalFile> = {}): LocalFile {
  return {
    name: relativePath.split(/[/\\]/).pop() || '',
    path: `${VAULT}\\${relativePath.replace(/\//g, '\\')}`,
    relativePath,
    isDirectory: false,
    extension: `.${relativePath.split('.').pop()}`,
    size: 1,
    modifiedTime: 'now',
    ...overrides,
  } as LocalFile
}

describe('findLocalFileByPath - existing path-matching strategies', () => {
  it('matches by exact path', () => {
    const file = localFile('Parts/PART-1.SLDPRT')
    const other = localFile('Parts/PART-2.SLDPRT')

    const result = findLocalFileByPath(file.path, [other, file])

    expect(result).toBe(file)
  })

  it('matches by path ending when the reported path has a different vault root', () => {
    const file = localFile('Parts/PART-1.SLDPRT')
    const reportedPath = `D:\\OtherVaultRoot\\Parts\\PART-1.SLDPRT`

    const result = findLocalFileByPath(reportedPath, [file])

    expect(result).toBe(file)
  })

  it('matches by filename only as a last resort', () => {
    const file = localFile('Parts/Deep/Nested/PART-1.SLDPRT')
    const reportedPath = 'Z:\\Unrelated\\Root\\PART-1.SLDPRT'

    const result = findLocalFileByPath(reportedPath, [file])

    expect(result).toBe(file)
  })

  it('returns undefined when nothing matches', () => {
    const file = localFile('Parts/PART-1.SLDPRT')

    const result = findLocalFileByPath('C:\\vault\\Parts\\NOTHING-HERE.SLDPRT', [file])

    expect(result).toBeUndefined()
  })
})

describe('findLocalFileByPath - moved_away stub redirection', () => {
  it('redirects an exact-path match on a stub to its moved partner', () => {
    const stub = localFile('Parts/OLD-LOCATION/PART-1.SLDPRT', {
      diffStatus: 'moved_away',
      movedToRelativePath: 'Parts/NEW-LOCATION/PART-1.SLDPRT',
    })
    const moved = localFile('Parts/NEW-LOCATION/PART-1.SLDPRT', { diffStatus: 'moved' })

    // Querying the database-recorded (stub's) path is exactly the case that used to prefer
    // the stub, since the exact-path strategy runs first and matches it directly.
    const result = findLocalFileByPath(stub.path, [stub, moved])

    expect(result).toBe(moved)
    expect(result).not.toBe(stub)
  })

  it('redirects regardless of which row the caller lists first', () => {
    const stub = localFile('Parts/OLD-LOCATION/PART-1.SLDPRT', {
      diffStatus: 'moved_away',
      movedToRelativePath: 'Parts/NEW-LOCATION/PART-1.SLDPRT',
    })
    const moved = localFile('Parts/NEW-LOCATION/PART-1.SLDPRT', { diffStatus: 'moved' })

    const result = findLocalFileByPath(stub.path, [moved, stub])

    expect(result).toBe(moved)
  })

  it('redirects a filename-only match on a stub to its moved partner', () => {
    const stub = localFile('Parts/OLD-LOCATION/PART-1.SLDPRT', {
      diffStatus: 'moved_away',
      movedToRelativePath: 'Parts/NEW-LOCATION/PART-1.SLDPRT',
    })
    const moved = localFile('Parts/NEW-LOCATION/PART-1.SLDPRT', { diffStatus: 'moved' })
    const reportedPath = 'Z:\\Unrelated\\Root\\PART-1.SLDPRT'

    const result = findLocalFileByPath(reportedPath, [stub, moved])

    expect(result).toBe(moved)
  })

  it('falls back to the stub itself when no partner is present in the given files', () => {
    const orphanStub = localFile('Parts/OLD-LOCATION/PART-1.SLDPRT', {
      diffStatus: 'moved_away',
      movedToRelativePath: 'Parts/NEW-LOCATION/PART-1.SLDPRT',
    })

    // The caller passed a subset of files that does not include the partner - still return a
    // result rather than silently dropping the file.
    const result = findLocalFileByPath(orphanStub.path, [orphanStub])

    expect(result).toBe(orphanStub)
  })

  it('falls back to the stub itself when it carries no destination', () => {
    const bareStub = localFile('Parts/OLD-LOCATION/PART-1.SLDPRT', {
      diffStatus: 'moved_away',
    })

    const result = findLocalFileByPath(bareStub.path, [bareStub])

    expect(result).toBe(bareStub)
  })

  it('does not redirect a match that is not a moved_away stub', () => {
    const file = localFile('Parts/PART-1.SLDPRT', { diffStatus: 'modified' })

    const result = findLocalFileByPath(file.path, [file])

    expect(result).toBe(file)
  })
})
