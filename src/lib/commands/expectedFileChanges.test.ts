import { describe, expect, it } from 'vitest'

import { withExpectedParentFolders } from './expectedFileChanges'

describe('withExpectedParentFolders', () => {
  it('includes every ancestor of each file, and the file itself', () => {
    expect(
      withExpectedParentFolders([
        '0 - SHARED/00 - REGRESSION TESTS/REGRESSION-TEST-T500X/part.sldprt',
      ]),
    ).toEqual([
      '0 - SHARED/00 - REGRESSION TESTS/REGRESSION-TEST-T500X/part.sldprt',
      '0 - SHARED',
      '0 - SHARED/00 - REGRESSION TESTS',
      '0 - SHARED/00 - REGRESSION TESTS/REGRESSION-TEST-T500X',
    ])
  })

  it('does not grow unbounded when many files share parents', () => {
    const paths = withExpectedParentFolders([
      '0 - SHARED/a/one.sldprt',
      '0 - SHARED/a/two.sldprt',
    ])
    expect(paths).toHaveLength(4)
    expect(paths).toEqual(expect.arrayContaining(['0 - SHARED', '0 - SHARED/a']))
  })

  it('normalizes backslashes so watcher events match', () => {
    expect(withExpectedParentFolders(['0 - SHARED\\folder\\file.sldprt'])).toEqual([
      '0 - SHARED/folder/file.sldprt',
      '0 - SHARED',
      '0 - SHARED/folder',
    ])
  })

  it('returns nothing for an empty or root path', () => {
    expect(withExpectedParentFolders(['', '/'])).toEqual([])
  })
})
