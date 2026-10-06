import { describe, expect, it } from 'vitest'

import { parseCommandString, tokenizeCommandString } from './parser'

describe('tokenizeCommandString', () => {
  it('splits on whitespace', () => {
    expect(tokenizeCommandString('checkout  ./a.sldprt\t--recursive')).toEqual([
      'checkout',
      './a.sldprt',
      '--recursive',
    ])
  })

  it('keeps a double-quoted run with spaces in one token and drops the quotes', () => {
    expect(tokenizeCommandString('cmd --path="0 - SHARED\\01-TOOLBOX" x')).toEqual([
      'cmd',
      '--path=0 - SHARED\\01-TOOLBOX',
      'x',
    ])
  })

  it('keeps a wholly quoted flag together', () => {
    expect(tokenizeCommandString('cmd "--path=0 - SHARED"')).toEqual(['cmd', '--path=0 - SHARED'])
  })

  it('treats backslashes and apostrophes literally', () => {
    expect(tokenizeCommandString("open C:\\Vault\\Bob's part.sldprt")).toEqual([
      'open',
      "C:\\Vault\\Bob's",
      'part.sldprt',
    ])
  })

  it('returns nothing for blank input', () => {
    expect(tokenizeCommandString('   ')).toEqual([])
  })
})

describe('parseCommandString', () => {
  it('reads a quoted long-flag value containing spaces', () => {
    const parsed = parseCommandString(
      'restore-metadata-from-files --exclude="0 - SHARED\\01-TOOLBOX;ARCHIVE" --apply',
    )
    expect(parsed.command).toBe('restore-metadata-from-files')
    expect(parsed.flags.exclude).toBe('0 - SHARED\\01-TOOLBOX;ARCHIVE')
    expect(parsed.flags.apply).toBe(true)
  })

  it('keeps everything after the first equals sign', () => {
    expect(parseCommandString('cmd --message=a=b').flags.message).toBe('a=b')
  })

  it('still parses unquoted commands as before', () => {
    expect(parseCommandString('Checkout ./Parts/a.sldprt -m hello --recursive')).toEqual({
      command: 'checkout',
      args: ['./Parts/a.sldprt'],
      flags: { m: 'hello', recursive: true },
    })
  })
})
