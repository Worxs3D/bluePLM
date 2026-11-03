import { describe, expect, it } from 'vitest'

import { getTranslation } from './index'
import type { Language } from './types'

const LOCALES: Language[] = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW']

const PLAIN_KEYS = [
  'performanceTelemetry.title',
  'performanceTelemetry.description',
  'performanceTelemetry.popOut',
  'performanceTelemetry.openWindow',
  'performanceTelemetry.fps',
  'performanceTelemetry.settings',
  'performanceTelemetry.sampleRate',
  'performanceTelemetry.sampleRateHint',
  'performanceTelemetry.retention',
  'performanceTelemetry.retentionHint',
  'performanceTelemetry.clearData',
  'performanceTelemetry.pause',
  'performanceTelemetry.start',
  'performanceTelemetry.clear',
  'performanceTelemetry.now',
  'performanceTelemetry.startRecording',
  'performanceTelemetry.stopRecording',
  'performanceTelemetry.telemetrySettings',
  'performanceTelemetry.sampleRateHz',
  'performanceTelemetry.retentionSeconds',
  'performanceTelemetry.trackedModules',
  'performanceTelemetry.moduleHeap',
  'performanceTelemetry.bufferSizeLabel',
  'performanceTelemetry.samples',
  'performanceTelemetry.telemetryData',
] as const

const COUNTED_KEYS = ['performanceTelemetry.bufferSize', 'performanceTelemetry.secondsAgo'] as const

const RATE_KEY = 'performanceTelemetry.recordingAt'

describe('performanceTelemetry.* keys exist in every locale', () => {
  it.each(LOCALES)('%s resolves every plain key to a sentence rather than the key', (locale) => {
    for (const key of PLAIN_KEYS) {
      const text = getTranslation(locale, key)
      expect(text, `${locale}: ${key}`).not.toBe(key)
      expect(text.length, `${locale}: ${key}`).toBeGreaterThan(0)
      expect(text, `${locale}: ${key}`).not.toMatch(/\{\{\w+\}\}/)
    }
  })

  it.each(LOCALES)('%s resolves counted keys and substitutes their values', (locale) => {
    for (const key of COUNTED_KEYS) {
      const text = getTranslation(locale, key, { count: 42 })
      expect(text, `${locale}: ${key}`).not.toBe(key)
      expect(text, `${locale}: ${key}`).toContain('42')
      expect(text, `${locale}: ${key}`).not.toMatch(/\{\{\w+\}\}/)
    }
  })

  it.each(LOCALES)('%s resolves the recording rate and substitutes its value', (locale) => {
    const text = getTranslation(locale, RATE_KEY, { rate: 30 })
    expect(text, `${locale}: ${RATE_KEY}`).not.toBe(RATE_KEY)
    expect(text, `${locale}: ${RATE_KEY}`).toContain('30')
    expect(text, `${locale}: ${RATE_KEY}`).not.toMatch(/\{\{\w+\}\}/)
  })
})
