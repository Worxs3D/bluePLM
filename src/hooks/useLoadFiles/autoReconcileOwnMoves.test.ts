import { beforeEach, describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'

import {
  resetAttemptedOwnMoves,
  rowsSettledAtServerPath,
  takeOwnInodeMoves,
} from './autoReconcileOwnMoves'

const ME = 'user-me'

function movedRow(
  localPath: string,
  options: { id?: string; checkedOutBy?: string | null; serverPath?: string } = {},
): LocalFile {
  const name = localPath.split('/').pop()!
  return {
    name,
    path: `C:/vault/${localPath}`,
    relativePath: localPath,
    isDirectory: false,
    extension: '.sldasm',
    size: 1,
    modifiedTime: '',
    diffStatus: 'moved',
    pdmData: {
      id: options.id ?? `row-${name}`,
      file_path: options.serverPath ?? `old/${name}`,
      checked_out_by: options.checkedOutBy === undefined ? ME : options.checkedOutBy,
    } as unknown as PDMFile,
  }
}

/** Every id in these tests was settled at its server path before the load. */
const ALL = { has: () => true } as unknown as ReadonlySet<string>

beforeEach(() => resetAttemptedOwnMoves())

describe('takeOwnInodeMoves', () => {
  it('takes an inode-matched move of a file this user holds', () => {
    const file = movedRow('new/a.sldasm', { id: 'a' })
    expect(takeOwnInodeMoves([file], new Set(['a']), ALL, ME)).toEqual(['a'])
  })

  it('leaves moves found any other way, or held by someone else or nobody, pending', () => {
    const byHash = movedRow('new/hash.sldasm', { id: 'hash' })
    const theirs = movedRow('new/theirs.sldasm', { id: 'theirs', checkedOutBy: 'user-ana' })
    const nobody = movedRow('new/nobody.sldasm', { id: 'nobody', checkedOutBy: null })
    expect(takeOwnInodeMoves([byHash, theirs, nobody], new Set(['theirs', 'nobody']), ALL, ME)).toEqual([])
  })

  it('skips a row whose server path already matches', () => {
    const file = movedRow('new/a.sldasm', { id: 'a', serverPath: 'NEW/a.sldasm' })
    expect(takeOwnInodeMoves([file], new Set(['a']), ALL, ME)).toEqual([])
  })

  it('tries each move once, so a write that keeps failing is not retried on every load', () => {
    const file = movedRow('new/a.sldasm', { id: 'a' })
    expect(takeOwnInodeMoves([file], new Set(['a']), ALL, ME)).toEqual(['a'])
    expect(takeOwnInodeMoves([file], new Set(['a']), ALL, ME)).toEqual([])
    // Moved on again: a new destination is a new move.
    const again = movedRow('newer/a.sldasm', { id: 'a' })
    expect(takeOwnInodeMoves([again], new Set(['a']), ALL, ME)).toEqual(['a'])
  })

  it('leaves a file that was already a pending move before this load', () => {
    const file = movedRow('newer/a.sldasm', { id: 'a' })
    expect(takeOwnInodeMoves([file], new Set(['a']), new Set(), ME)).toEqual([])
  })
})

describe('rowsSettledAtServerPath', () => {
  it('counts rows sitting at their server path, not pending moves, stubs or cloud rows', () => {
    const settled = { ...movedRow('old/s.sldasm', { id: 's' }), diffStatus: 'modified' as const }
    const ghost = { ...movedRow('old/g.sldasm', { id: 'g' }), diffStatus: 'deleted' as const }
    const pending = movedRow('elsewhere/p.sldasm', { id: 'p' })
    const stub = { ...movedRow('old/p.sldasm', { id: 'p' }), diffStatus: 'moved_away' as const }
    const cloud = { ...movedRow('old/c.sldasm', { id: 'c' }), diffStatus: 'cloud' as const }
    expect([...rowsSettledAtServerPath([settled, ghost, pending, stub, cloud])]).toEqual(['s', 'g'])
  })
})
