/**
 * Candidate 1 from the Toolbox OOM incident: `listWorkingFilesDelta` given directory
 * paths deletes every cache key under that directory, then re-scans the subtree.
 *
 * The two watcher paths that fired were siblings that share a prefix:
 *   REGRESSION-TEST-T500X
 *   REGRESSION-TEST-T500X - Copy
 *
 * A bare `startsWith(dir)` would delete the Copy tree while processing T500X.
 * The delta handler (and `isPathWithinDirectory`) require a separator boundary.
 * This test pins that contract so a future rewrite cannot recreate it.
 */

import { describe, expect, it } from 'vitest'

import { isPathWithinDirectory } from './utils/path'

const T500X = '0 - SHARED/00 - REGRESSION TESTS/REGRESSION-TEST-T500X'
const T500X_COPY = '0 - SHARED/00 - REGRESSION TESTS/REGRESSION-TEST-T500X - Copy'

function dropSubtreeKeys(keys: string[], directory: string): string[] {
  return keys.filter((key) => !isPathWithinDirectory(key, directory))
}

describe('delta scan of directory watcher paths', () => {
  const cacheKeys = [
    T500X,
    `${T500X}/part.sldprt`,
    T500X_COPY,
    `${T500X_COPY}/part.sldprt`,
    '0 - SHARED/00 - REGRESSION TESTS',
    '0 - SHARED/01-TOOLBOX/fastener.sldprt',
  ]

  it('does not drop a sibling folder whose name starts with the changed directory', () => {
    const after = dropSubtreeKeys(cacheKeys, T500X)
    expect(after).toEqual(
      expect.arrayContaining([
        T500X_COPY,
        `${T500X_COPY}/part.sldprt`,
        '0 - SHARED/01-TOOLBOX/fastener.sldprt',
      ]),
    )
    expect(after).not.toContain(T500X)
    expect(after).not.toContain(`${T500X}/part.sldprt`)
  })

  it('returns a list no larger than the cache it patched — directories do not duplicate rows', () => {
    const afterFirst = dropSubtreeKeys(cacheKeys, T500X)
    const reseated = [
      ...afterFirst,
      T500X,
      `${T500X}/part.sldprt`,
    ]
    const unique = new Set(reseated)
    expect(reseated).toHaveLength(unique.size)
    expect(reseated).toHaveLength(cacheKeys.length)
  })
})
