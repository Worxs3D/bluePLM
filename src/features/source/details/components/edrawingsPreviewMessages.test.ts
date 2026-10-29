import { describe, expect, it } from 'vitest'

import { en } from '@/lib/i18n/locales/en'

import { PREVIEW_MESSAGE_KEYS } from './edrawingsPreviewMessages'

describe('embedded eDrawings preview messages', () => {
  it('tells a network-share vault apart from a file that is not downloaded', () => {
    expect(PREVIEW_MESSAGE_KEYS['preview-vault-not-local']).toBe('solidworksSettings.previewVaultOnNetwork')
    expect(PREVIEW_MESSAGE_KEYS['file-not-downloaded']).toBe('solidworksSettings.previewNotLocal')
  })

  it('points every message at an English string', () => {
    const settings = en.solidworksSettings as Record<string, string>
    for (const key of Object.values(PREVIEW_MESSAGE_KEYS)) {
      expect(settings[key.replace('solidworksSettings.', '')], key).toEqual(expect.any(String))
    }
  })
})
