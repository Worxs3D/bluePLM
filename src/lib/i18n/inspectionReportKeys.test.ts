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
import { FAI_REASONS, INSPECTION_REPORT_STATUSES, INSPECTION_REPORT_TYPES } from '@/types/inspectionReports'
import {
  faiReasonKey,
  reportTypeChipKey,
  reportTypeKey,
} from '@/features/integrations/solidworks/inspection/reports/reportTypeModel'
import { REPORT_NUMBER_TOKENS } from '@/features/integrations/solidworks/inspection/reports/reportModel'

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

  it('names every report type, FAI scope and reason, selection note and sampling error', () => {
    const types = [...INSPECTION_REPORT_TYPES, null]
    expectKeys(types.map(reportTypeKey))
    expectKeys(types.map(reportTypeChipKey))
    expectKeys(INSPECTION_REPORT_TYPES.flatMap((t) => [`source.inspection.rptTypeShort_${t}`, `source.inspection.rptTypeHint_${t}`]))
    expectKeys(['full', 'partial'].map((s) => `source.inspection.rptFaiScope_${s}`))
    expectKeys(FAI_REASONS.map(faiReasonKey))
    expectKeys(
      ['none_changed', 'none_chosen', 'no_classified', 'no_baseline'].map((n) => `source.inspection.rptSelectionEmpty_${n}`),
    )
    expectKeys(
      ['lot_size_needed', 'sample_larger_than_lot', 'too_many_measurements'].map((e) => `source.inspection.rptSamplingError_${e}`),
    )
    expectKeys(['all', 'classified', 'changed', 'chosen'].map((s) => `source.inspection.rptScopeText_${s}`))
    expectKeys(['100', 'fixed'].flatMap((p) => [`source.inspection.rptSampling_${p}`, `source.inspection.rptSamplingPlan_${p}`]))
    expectKeys(['classified', 'all', 'chosen'].map((m) => `source.inspection.rptCharMode_${m}`))
    expectKeys(['classified', 'all'].map((m) => `source.inspection.rnLotScope_${m}`))
  })

  it('describes every report number token and sequence scope', () => {
    expectKeys(REPORT_NUMBER_TOKENS.map((tok) => `source.inspection.rnTok_${tok}`))
    expectKeys(['drawing', 'revision'].map((s) => `source.inspection.rnScope_${s}`))
  })
})
