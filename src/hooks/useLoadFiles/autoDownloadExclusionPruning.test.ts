import { describe, expect, it } from 'vitest'

import { findExclusionsForFilesPresentLocally } from './autoDownloadExclusionPruning'

function row(
  relativePath: string,
  diffStatus?: 'cloud' | 'deleted' | 'moved_away' | 'modified',
  isDirectory = false,
) {
  return { relativePath, isDirectory, diffStatus }
}

describe('findExclusionsForFilesPresentLocally', () => {
  it('drops exclusions whose file is on disk again, keeps the cloud-only ones', () => {
    const stale = findExclusionsForFilesPresentLocally(
      ['A/back.sldprt', 'A/gone.sldprt', 'B/edited.sldprt'],
      [row('A/back.sldprt'), row('A/gone.sldprt', 'cloud'), row('B/edited.sldprt', 'modified')],
    )

    expect([...stale].sort()).toEqual(['A/back.sldprt', 'B/edited.sldprt'])
  })

  it('does not count deleted rows, moved-away stubs or directories as present', () => {
    const stale = findExclusionsForFilesPresentLocally(
      ['a.sldprt', 'b.sldprt', 'dir'],
      [row('a.sldprt', 'deleted'), row('b.sldprt', 'moved_away'), row('dir', undefined, true)],
    )

    expect(stale.size).toBe(0)
  })

  it('matches case-insensitively like the rest of the load pipeline', () => {
    const stale = findExclusionsForFilesPresentLocally(['Parts/Bracket.SLDPRT'], [row('parts/bracket.sldprt')])

    expect([...stale]).toEqual(['Parts/Bracket.SLDPRT'])
  })

  it('does nothing for an empty list', () => {
    expect(findExclusionsForFilesPresentLocally([], [row('a')]).size).toBe(0)
  })
})
