import path from 'path'
import { describe, expect, it } from 'vitest'

import { resolveDivergenceReportPath } from './divergenceReportPath'

const LOGS_DIR = path.join('C:', 'Users', 'someone', 'AppData', 'Roaming', 'blue-plm', 'logs')

describe('resolveDivergenceReportPath', () => {
  it('places a generated report name under logs/divergence', () => {
    expect(resolveDivergenceReportPath(LOGS_DIR, 'divergence-report-2026-10-01T16-02-11-123.json')).toBe(
      path.join(LOGS_DIR, 'divergence', 'divergence-report-2026-10-01T16-02-11-123.json'),
    )
  })

  it.each([
    '..\\..\\vault\\evil.json',
    '../divergence-report-x.json',
    'divergence-report-x.json\\..\\..\\x.json',
    'C:\\divergence-report-x.json',
    'divergence-report-x.exe',
    'notes.json',
    '',
  ])('refuses %j', (fileName) => {
    expect(resolveDivergenceReportPath(LOGS_DIR, fileName)).toBeNull()
  })
})
