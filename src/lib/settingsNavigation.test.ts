import { describe, expect, it, vi } from 'vitest'
import { SETTINGS_TABS } from '@/types/settings'
import {
  applySettingsNavigationEvent,
  registerSettingsNavigationListener,
} from './settingsNavigation'

describe('settings navigation events', () => {
  it.each(SETTINGS_TABS)('opens the settings view for %s', (tab) => {
    const actions = { setActiveView: vi.fn(), setSettingsTab: vi.fn() }
    expect(
      applySettingsNavigationEvent(
        new CustomEvent('navigate-settings-tab', { detail: tab }),
        actions,
      ),
    ).toBe(true)
    expect(actions.setSettingsTab).toHaveBeenCalledWith(tab)
    expect(actions.setActiveView).toHaveBeenCalledWith('settings')
  })

  it.each(['unknown', null, 42])('ignores invalid tab %s', (tab) => {
    const actions = { setActiveView: vi.fn(), setSettingsTab: vi.fn() }
    expect(
      applySettingsNavigationEvent(
        new CustomEvent('navigate-settings-tab', { detail: tab }),
        actions,
      ),
    ).toBe(false)
    expect(actions.setActiveView).not.toHaveBeenCalled()
    expect(actions.setSettingsTab).not.toHaveBeenCalled()
  })

  it('registers and disposes the listener', () => {
    const target = new EventTarget() as unknown as Window
    const actions = { setActiveView: vi.fn(), setSettingsTab: vi.fn() }
    const dispose = registerSettingsNavigationListener(target, actions)
    target.dispatchEvent(new CustomEvent('navigate-settings-tab', { detail: 'export' }))
    expect(actions.setSettingsTab).toHaveBeenCalledWith('export')
    expect(actions.setActiveView).toHaveBeenCalledWith('settings')
    dispose()
    target.dispatchEvent(new CustomEvent('navigate-settings-tab', { detail: 'export' }))
    expect(actions.setSettingsTab).toHaveBeenCalledTimes(1)
  })
})
