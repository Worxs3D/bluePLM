import { describe, expect, it, vi } from 'vitest'
import { applySettingsNavigationEvent, registerSettingsNavigationListener } from './settingsNavigation'

describe('settings navigation events', () => {
  it('opens the settings view on the requested tab', () => {
    const setActiveView = vi.fn()
    const setSettingsTab = vi.fn()

    expect(
      applySettingsNavigationEvent(new CustomEvent('navigate-settings-tab', { detail: 'export' }), {
        setActiveView,
        setSettingsTab,
      }),
    ).toBe(true)
    expect(setSettingsTab).toHaveBeenCalledWith('export')
    expect(setActiveView).toHaveBeenCalledWith('settings')
  })

  it('ignores unknown tabs', () => {
    const actions = { setActiveView: vi.fn(), setSettingsTab: vi.fn() }
    expect(
      applySettingsNavigationEvent(new CustomEvent('navigate-settings-tab', { detail: 'unknown' }), actions),
    ).toBe(false)
    expect(actions.setActiveView).not.toHaveBeenCalled()
  })

  it('registers the real listener seam and navigates on a dispatched event', () => {
    const target = new EventTarget() as unknown as Window
    const setActiveView = vi.fn()
    const setSettingsTab = vi.fn()
    const dispose = registerSettingsNavigationListener(target, { setActiveView, setSettingsTab })
    target.dispatchEvent(new CustomEvent('navigate-settings-tab', { detail: 'export' }))
    expect(setSettingsTab).toHaveBeenCalledWith('export')
    expect(setActiveView).toHaveBeenCalledWith('settings')
    dispose()
    target.dispatchEvent(new CustomEvent('navigate-settings-tab', { detail: 'export' }))
    expect(setSettingsTab).toHaveBeenCalledTimes(1)
  })
})
