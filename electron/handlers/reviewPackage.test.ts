import path from 'path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))

const { isInsideStagingDir, isStagingDir } = await import('./reviewPackage')

const tmp = path.resolve('/tmp-root')

describe('isStagingDir', () => {
  it('accepts only a prefixed folder directly under the temp folder', () => {
    expect(isStagingDir(path.join(tmp, 'blueplm-review-abc'), tmp)).toBe(true)
    expect(isStagingDir(path.join(tmp, 'other'), tmp)).toBe(false)
    expect(isStagingDir(path.join(tmp, 'blueplm-review-abc', 'nested'), tmp)).toBe(false)
    expect(isStagingDir(tmp, tmp)).toBe(false)
    expect(isStagingDir(path.join(tmp, 'blueplm-review-abc', '..', '..', 'x'), tmp)).toBe(false)
  })
})

describe('isInsideStagingDir', () => {
  it('accepts files inside a staging folder and nothing else', () => {
    expect(isInsideStagingDir(path.join(tmp, 'blueplm-review-abc', 'r.pdf'), tmp)).toBe(true)
    expect(isInsideStagingDir(path.join(tmp, 'blueplm-review-abc'), tmp)).toBe(false)
    expect(isInsideStagingDir(path.join(tmp, 'other', 'r.pdf'), tmp)).toBe(false)
    expect(
      isInsideStagingDir(path.join(tmp, 'blueplm-review-abc', '..', 'other', 'r.pdf'), tmp),
    ).toBe(false)
    expect(isInsideStagingDir(path.resolve('/elsewhere/blueplm-review-x/r.pdf'), tmp)).toBe(false)
  })
})
