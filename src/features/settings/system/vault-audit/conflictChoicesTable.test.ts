import { describe, expect, it } from 'vitest'

import { getTranslation } from '@/lib/i18n'
import type { VaultAuditFinding } from '@/types/vaultAudit'

import {
  formatConflictChoicesTable,
  normalizeChoicePath,
  parseConflictChoicesTable,
  planConflictChoices,
  type ConflictChoiceRules,
} from './conflictChoicesTable'

function conflict(overrides: Partial<VaultAuditFinding>): VaultAuditFinding {
  return {
    id: 'f1:file:description',
    kind: 'conflicting',
    resolution: 'choose-a-side',
    fileId: 'f1',
    relativePath: 'BB120\\DEVELOPMENT\\CAB\\JUMPER.SLDASM',
    fileName: 'JUMPER.SLDASM',
    fileType: 'assembly',
    field: 'description',
    scope: 'file',
    configuration: null,
    databaseValue: 'Cable, Negative',
    fileValue: 'Cable',
    repairValue: null,
    unattributedReason: null,
    ...overrides,
  }
}

const FINDINGS: VaultAuditFinding[] = [
  conflict({}),
  conflict({
    id: 'f1:file:part_number',
    field: 'part_number',
    databaseValue: 'BR-1-001',
    fileValue: 'BR-1-XXX',
  }),
  conflict({
    id: 'f2:config:config_description:4F',
    fileId: 'f2',
    relativePath: 'WLC\\RETAIL PACKS\\WLC INSERT - RP ASSEMBLY.SLDASM',
    fileName: 'WLC INSERT - RP ASSEMBLY.SLDASM',
    field: 'config_description',
    scope: 'configuration',
    configuration: '4F',
    databaseValue: 'Insert, 4F',
    fileValue: 'Insert, 4M',
  }),
  conflict({
    id: 'f3:file:description',
    fileId: 'f3',
    relativePath: 'WTE\\STAMP\\WTE2-CLAMP-STAMP.SLDPRT',
    fileName: 'WTE2-CLAMP-STAMP.SLDPRT',
    databaseValue: 'Stamp for "WTE 2" Clamp',
    fileValue: 'Sticker for "WTE2" Clamp',
  }),
  conflict({
    id: 'f4:file:description',
    fileId: 'f4',
    relativePath: 'A\\SAME.SLDPRT',
    fileName: 'SAME.SLDPRT',
  }),
  conflict({
    id: 'f5:file:description',
    fileId: 'f5',
    relativePath: 'B\\SAME.SLDPRT',
    fileName: 'SAME.SLDPRT',
  }),
]

const OPEN: ConflictChoiceRules = { canUseBluePlm: () => true, canUseFile: () => true }

function plan(text: string, rules: ConflictChoiceRules = OPEN) {
  const parsed = parseConflictChoicesTable(text)
  return { parsed, plan: planConflictChoices(parsed.lines, FINDINGS, rules) }
}

describe('conflict choices table', () => {
  it('round-trips the choices on screen through a copied table', () => {
    const text = formatConflictChoicesTable(FINDINGS, {
      bluePlmFileIds: new Set(['f1', 'f3']),
      fileFindingIds: new Set(['f2:config:config_description:4F']),
    })
    const { parsed, plan: result } = plan(text)

    expect(parsed.errors).toEqual([])
    expect(result.skipped).toEqual([])
    expect(result.bluePlmFileIds.sort()).toEqual(['f1', 'f3'])
    expect(result.fileFindingIds).toEqual(['f2:config:config_description:4F'])
    expect(result.touchedFileIds.sort()).toEqual(['f1', 'f2', 'f3'])
  })

  it('keeps quoted values intact the way a spreadsheet copies them', () => {
    const text = formatConflictChoicesTable(FINDINGS, {
      bluePlmFileIds: new Set(['f3']),
      fileFindingIds: new Set(),
    })
    expect(text).toContain('"Stamp for ""WTE 2"" Clamp"')
    const line = parseConflictChoicesTable(text).lines.find((entry) => entry.path.includes('WTE2'))
    expect(line?.databaseValue).toBe('Stamp for "WTE 2" Clamp')
  })

  it('leaves files with a blank choice alone', () => {
    const text = formatConflictChoicesTable(FINDINGS, {
      bluePlmFileIds: new Set(),
      fileFindingIds: new Set(),
    })
    const { parsed, plan: result } = plan(text)
    expect(parsed.lines).toEqual([])
    expect(result.bluePlmFileIds).toEqual([])
    expect(result.fileFindingIds).toEqual([])
  })

  it('matches a whole file by the path the screen shows, or by a unique name', () => {
    const { plan: result } = plan(
      [
        'File\tChoice',
        'BB120 / DEVELOPMENT / CAB / JUMPER.SLDASM\tUse BluePLM',
        'wte2-clamp-stamp.sldprt\tBluePLM',
        'Vault Root/WLC/RETAIL PACKS/WLC INSERT - RP ASSEMBLY.SLDASM\tbluePLM',
      ].join('\n'),
    )
    expect(result.skipped).toEqual([])
    expect(result.bluePlmFileIds.sort()).toEqual(['f1', 'f2', 'f3'])
  })

  it('reads a Markdown table', () => {
    const { parsed, plan: result } = plan(
      [
        '| File | Field | Choice |',
        '|---|---|---|',
        '| BB120/DEVELOPMENT/CAB/JUMPER.SLDASM | | BluePLM |',
      ].join('\n'),
    )
    expect(parsed.errors).toEqual([])
    expect(result.bluePlmFileIds).toEqual(['f1'])
  })

  it('skips a file name that more than one conflicting file has', () => {
    const { plan: result } = plan('File\tChoice\nSAME.SLDPRT\tBluePLM')
    expect(result.bluePlmFileIds).toEqual([])
    expect(result.skipped).toEqual([{ line: 2, path: 'SAME.SLDPRT', reason: 'ambiguous-file' }])
  })

  it('skips a line whose values changed since the table was made', () => {
    const { plan: result } = plan(
      [
        'File\tField\tBluePLM value\tFile value\tChoice',
        'BB120/DEVELOPMENT/CAB/JUMPER.SLDASM\tdescription\tCable, Positive\tCable\tFile',
        'BB120/DEVELOPMENT/CAB/JUMPER.SLDASM\tpart number\tBR-1-001\t BR-1-XXX \tFile',
      ].join('\n'),
    )
    expect(result.fileFindingIds).toEqual(['f1:file:part_number'])
    expect(result.skipped).toEqual([
      { line: 2, path: 'BB120/DEVELOPMENT/CAB/JUMPER.SLDASM', reason: 'value-changed' },
    ])
  })

  it('skips every line of a file the table sends both ways', () => {
    const { plan: result } = plan(
      [
        'File\tField\tChoice',
        'BB120/DEVELOPMENT/CAB/JUMPER.SLDASM\tdescription\tBluePLM',
        'BB120/DEVELOPMENT/CAB/JUMPER.SLDASM\tpart number\tFile',
      ].join('\n'),
    )
    expect(result.bluePlmFileIds).toEqual([])
    expect(result.fileFindingIds).toEqual([])
    expect(result.skipped.map((skip) => skip.reason)).toEqual(['mixed-choices', 'mixed-choices'])
  })

  it('needs a field and configuration to take a file value', () => {
    const { plan: result } = plan(
      [
        'File\tConfiguration\tField\tChoice',
        'WLC/RETAIL PACKS/WLC INSERT - RP ASSEMBLY.SLDASM\t\t\tFile',
        'WLC/RETAIL PACKS/WLC INSERT - RP ASSEMBLY.SLDASM\t4M\tconfiguration description\tFile',
        'WLC/RETAIL PACKS/WLC INSERT - RP ASSEMBLY.SLDASM\t4f\tconfiguration description\tFile',
      ].join('\n'),
    )
    expect(result.fileFindingIds).toEqual(['f2:config:config_description:4F'])
    expect(result.skipped.map((skip) => skip.reason)).toEqual(['needs-field', 'no-such-value'])
  })

  it('does not choose a side the screen would not offer', () => {
    const { plan: result } = plan('File\tChoice\nBB120/DEVELOPMENT/CAB/JUMPER.SLDASM\tBluePLM', {
      canUseBluePlm: () => false,
      canUseFile: () => true,
    })
    expect(result.bluePlmFileIds).toEqual([])
    expect(result.skipped[0].reason).toBe('not-available')
  })

  it('reports a missing header and unknown words instead of guessing', () => {
    expect(parseConflictChoicesTable('JUMPER.SLDASM\tBluePLM').errors[0].error).toBe(
      'no-file-column',
    )
    expect(parseConflictChoicesTable('just text').errors[0].error).toBe('no-header')
    const parsed = parseConflictChoicesTable(
      'File\tField\tChoice\nJUMPER.SLDASM\tcolour\tBluePLM\nJUMPER.SLDASM\t\tmaybe',
    )
    expect(parsed.errors.map((error) => error.error)).toEqual(['unknown-field', 'unknown-choice'])
  })

  it('folds the path forms people paste', () => {
    expect(normalizeChoicePath(' WLC / 01-MECHANICAL DESIGN FILES / X.SLDPRT ')).toBe(
      'wlc/01-mechanical design files/x.sldprt',
    )
    expect(normalizeChoicePath('\\WLC\\X.SLDPRT\\')).toBe('wlc/x.sldprt')
  })

  it('has every string the dialog shows', () => {
    const keys = [
      'copy',
      'copyHint',
      'copied',
      'copyFailed',
      'paste',
      'pasteHint',
      'title',
      'instruction',
      'placeholder',
      'summary',
      'nothing',
      'skippedHeading',
      'line',
      'more',
      'note',
      'cancel',
      'apply',
      'appliedToast',
      'skipNoSuchFile',
      'skipAmbiguousFile',
      'skipNoSuchValue',
      'skipValueChanged',
      'skipNeedsField',
      'skipMixedChoices',
      'skipNotAvailable',
      'errorNoHeader',
      'errorNoFileColumn',
      'errorNoChoiceColumn',
      'errorUnreadableLine',
      'errorUnknownField',
      'errorUnknownChoice',
    ]
    for (const key of keys) {
      expect(getTranslation('en', `vaultAudit.choicesTable.${key}`), key).not.toBe(
        `vaultAudit.choicesTable.${key}`,
      )
    }
  })
})
