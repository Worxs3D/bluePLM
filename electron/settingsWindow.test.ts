import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {} }))

import { readFileSync } from 'fs'
import path from 'path'

import { isSettingsWindowRequest, restorableBounds, SETTINGS_WINDOW_FRAME } from './settingsWindow'

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 }
const RIGHT = { x: 1920, y: 0, width: 2560, height: 1400 }

describe('isSettingsWindowRequest', () => {
  it('matches the frame name the renderer opens', () => {
    const renderer = readFileSync(
      path.resolve(__dirname, '../src/features/settings/components/settingsWindowLayout.ts'),
      'utf-8',
    )
    expect(renderer).toContain(`SETTINGS_WINDOW_FRAME = '${SETTINGS_WINDOW_FRAME}'`)
  })

  it('lets only the empty settings page through', () => {
    expect(isSettingsWindowRequest('about:blank', 'blueplm-settings')).toBe(true)
    expect(isSettingsWindowRequest('', 'blueplm-settings')).toBe(true)
    expect(isSettingsWindowRequest('https://example.com', 'blueplm-settings')).toBe(false)
    expect(isSettingsWindowRequest('about:blank', '_blank')).toBe(false)
  })
})

describe('restorableBounds', () => {
  it('puts the window back on the second screen it was left on', () => {
    const saved = { x: 2200, y: 100, width: 1000, height: 800 }
    expect(restorableBounds(saved, [PRIMARY, RIGHT])).toEqual(saved)
  })

  it('drops bounds whose screen is gone', () => {
    expect(restorableBounds({ x: 2200, y: 100, width: 1000, height: 800 }, [PRIMARY])).toBeNull()
  })

  it('drops bounds whose title bar is off every screen', () => {
    expect(restorableBounds({ x: 100, y: -500, width: 1000, height: 800 }, [PRIMARY])).toBeNull()
  })

  it('keeps the minimum size', () => {
    expect(restorableBounds({ x: 10, y: 10, width: 100, height: 100 }, [PRIMARY])).toEqual({
      x: 10,
      y: 10,
      width: 640,
      height: 420,
    })
  })

  it('has nothing to restore on first open', () => {
    expect(restorableBounds(null, [PRIMARY])).toBeNull()
  })
})
