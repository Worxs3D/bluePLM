import { describe, expect, it } from 'vitest'

import { SCALAR_NAMES } from '@/lib/inspection/excel'
import {
  BUILT_IN_DESCRIPTION_KEYS,
  BUILT_IN_NAME_KEYS,
  DRAWING_OMITTED_REASONS,
  drawingOmittedKey,
  RETURNED_ISSUE_CODES,
  returnedIssueKey,
  TEMPLATE_ISSUE_CODES,
  templateIssueKey,
} from '@/lib/inspection/issueText'
import { INSPECTION_REPORT_STATUSES } from '@/types/inspectionReports'

import { en } from './locales/en'
import { flattenTranslations } from './utils'

const flat = flattenTranslations(en)

function expectKeys(keys: readonly string[]) {
  const missing = keys.filter((k) => !(k in flat))
  expect(missing).toEqual([])
}

describe('inspection report strings (source.inspection, English only)', () => {
  it('translates every template issue code', () => {
    expectKeys(TEMPLATE_ISSUE_CODES.map(templateIssueKey))
  })

  it('translates every returned-workbook issue code', () => {
    expectKeys(RETURNED_ISSUE_CODES.map(returnedIssueKey))
  })

  it('explains every reason a report went out without the drawing', () => {
    expectKeys(DRAWING_OMITTED_REASONS.map(drawingOmittedKey))
  })

  it('names every status, phase, count and analysis status', () => {
    expectKeys(INSPECTION_REPORT_STATUSES.map((s) => `source.inspection.rptStatus_${s}`))
    expectKeys(
      ['rows', 'template', 'drawing', 'workbook', 'upload', 'record'].map((p) => `source.inspection.rptPhase_${p}`),
    )
    expectKeys(['total', 'pass', 'fail', 'blank'].map((c) => `source.inspection.rptCount_${c}`))
    expectKeys(['ready', 'warnings', 'errors', 'unknown'].map((s) => `source.inspection.tplStatus_${s}`))
  })

  it('describes every header token and names every built-in template', () => {
    expectKeys(SCALAR_NAMES.map((n) => `source.inspection.tplTok_${n}`))
    expectKeys([...Object.values(BUILT_IN_NAME_KEYS), ...Object.values(BUILT_IN_DESCRIPTION_KEYS)])
  })
})
