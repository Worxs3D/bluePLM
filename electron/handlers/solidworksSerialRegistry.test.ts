import { describe, expect, it } from 'vitest'
import { parseSerialNumbersRegistry } from './solidworksSerialRegistry'

describe('parseSerialNumbersRegistry', () => {
  it('reads product names and serials from reg query output (CRLF)', () => {
    const out = [
      '',
      'HKEY_LOCAL_MACHINE\\Software\\SolidWorks\\Licenses\\Serial Numbers',
      '    SolidWorks    REG_SZ    9000 0000 0000 4821 QZXC 7TVB',
      '    Inspection    REG_SZ    9000 0000 0000 6603 KLMN 2PQR',
      '',
    ].join('\r\n')
    expect(parseSerialNumbersRegistry(out)).toEqual([
      { product: 'SolidWorks', serial: '9000 0000 0000 4821 QZXC 7TVB' },
      { product: 'Inspection', serial: '9000 0000 0000 6603 KLMN 2PQR' },
    ])
  })

  it('keeps value names that contain spaces', () => {
    const out = '    SOLIDWORKS Simulation    REG_SZ    9000 0000 0000 1111 AAAA BBBB\n'
    expect(parseSerialNumbersRegistry(out)).toEqual([
      { product: 'SOLIDWORKS Simulation', serial: '9000 0000 0000 1111 AAAA BBBB' },
    ])
  })

  it('skips values with empty data, the default value and the key line', () => {
    const out = [
      'HKEY_LOCAL_MACHINE\\Software\\SolidWorks\\Licenses\\Serial Numbers',
      '    (Default)    REG_SZ    x',
      '    9000000000001111AAAABBBB    REG_SZ    ',
      '    Count    REG_DWORD    0x1',
    ].join('\n')
    expect(parseSerialNumbersRegistry(out)).toEqual([])
  })
})
