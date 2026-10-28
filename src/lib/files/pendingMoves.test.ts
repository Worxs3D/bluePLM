import { describe, expect, it } from 'vitest'
import { stubCountsAsMoveIn } from './pendingMoves'

// The T4000 case: the assembly moved into a new subfolder of the folder it left.
const stub = {
  movedToRelativePath:
    'T4000/development/7000aw angular contact bearing/angular-contact-bearing-7000aw.SLDASM',
}

describe('stubCountsAsMoveIn', () => {
  it('does not count the stub where the moved file is counted too', () => {
    expect(stubCountsAsMoveIn(stub, 'T4000')).toBe(false)
    expect(stubCountsAsMoveIn(stub, 'T4000/development')).toBe(false)
    expect(stubCountsAsMoveIn(stub, '')).toBe(false)
  })

  it('counts the stub in a folder the file left entirely', () => {
    expect(stubCountsAsMoveIn(stub, 'T3000')).toBe(true)
    expect(stubCountsAsMoveIn(stub, 'T4000/develop')).toBe(true)
  })

  it('compares paths without case, as Windows does', () => {
    expect(stubCountsAsMoveIn(stub, 't4000/DEVELOPMENT')).toBe(false)
  })

  it('counts a stub with no destination, so a move is never hidden', () => {
    expect(stubCountsAsMoveIn({}, 'T4000')).toBe(true)
  })
})
