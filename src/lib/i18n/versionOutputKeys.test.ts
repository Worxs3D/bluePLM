import { describe, expect, it } from 'vitest'

import { OUTPUT_REASON_CODES, outputReasonKey } from '@/features/source/outputs/outputRowModel'

import { en } from './locales/en'
import { flattenTranslations } from './utils'

const flat = flattenTranslations(en)

/** Every `source.outputs.*` key the output rows, menus, toasts and settings call. */
const USED = [
  'alreadyThere', 'cannotGenerate', 'copyFailed', 'copyName', 'downloaded', 'generateFailedOne',
  'generateFailedSome', 'generateHint', 'generatePdf', 'generatePdfCount', 'generateStep',
  'generateStepCount', 'generatedCount', 'generatingCount', 'nameCopied', 'nameTaken', 'open',
  'openFailed', 'reason_unknown', 'regenerate', 'regenerating', 'rowApproximateTitle',
  'rowFailedTitle', 'rowGenerate', 'rowGenerateTitle', 'rowGenerating', 'rowOpenTitle', 'rowQueued',
  'rowRegeneratingTitle', 'saveCopy', 'saveFailed', 'saveNext', 'saved', 'settingsAdminOnly',
  'settingsDescription', 'settingsNoPermission', 'settingsPdf', 'settingsPdfHint',
  'settingsSaveFailed', 'settingsSaved', 'settingsStep', 'settingsStepHint', 'settingsTitle',
]

describe('version output strings (source.outputs, English only)', () => {
  it('has every key the UI uses', () => {
    expect(USED.map((k) => `source.outputs.${k}`).filter((k) => !(k in flat))).toEqual([])
  })

  it('explains every status code of the outputs library', () => {
    expect(OUTPUT_REASON_CODES.map(outputReasonKey).filter((k) => !(k in flat))).toEqual([])
  })
})
