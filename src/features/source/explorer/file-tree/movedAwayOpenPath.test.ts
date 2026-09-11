/**
 * `resolveMovedAwayOpenPath` backs `FileTree.tsx`'s `handleTreeItemDoubleClick`: a
 * `'moved_away'` stub sits at the vault's recorded path, but there is nothing on disk there
 * anymore - the content lives at `movedToRelativePath`. Double-clicking the stub must open
 * the real location instead of silently failing (or opening whatever unrelated file now
 * occupies the recorded path). See `.cursor/plans/realign-4.4.0-foldin-report.md`.
 */

import { describe, expect, it } from 'vitest'

import { resolveMovedAwayOpenPath } from './movedAwayOpenPath'

const VAULT_PATH = 'C:\\vault'

describe('resolveMovedAwayOpenPath', () => {
  it('builds the full path to the destination the stub names', () => {
    const result = resolveMovedAwayOpenPath(
      { movedToRelativePath: 'Parts/NEW-LOCATION/DRAWING-1.SLDDRW' },
      VAULT_PATH,
    )

    expect(result).toBe('C:\\vault\\Parts/NEW-LOCATION/DRAWING-1.SLDDRW'.replace(/\//g, '\\'))
  })

  it('returns null when the stub has no recorded destination', () => {
    expect(resolveMovedAwayOpenPath({ movedToRelativePath: undefined }, VAULT_PATH)).toBeNull()
  })

  it('returns null when there is no connected vault to resolve against', () => {
    expect(
      resolveMovedAwayOpenPath({ movedToRelativePath: 'Parts/NEW-LOCATION/DRAWING-1.SLDDRW' }, null),
    ).toBeNull()
  })
})
