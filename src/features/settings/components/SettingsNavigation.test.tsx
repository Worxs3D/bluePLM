// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { usePDMStore } from '@/stores/pdmStore'
import { SettingsNavigation } from './SettingsNavigation'

afterEach(() => {
  cleanup()
  usePDMStore.setState({
    language: 'en',
    settingsTab: 'profile',
    settingsSearchQuery: '',
    settingsSearchActiveIndex: 0,
    settingsFocusTarget: null,
  })
})

it('updates navigation when the selected language changes', () => {
  usePDMStore.setState({ language: 'en' })
  render(<SettingsNavigation activeTab="profile" onTabChange={vi.fn()} />)
  expect(screen.getByText('Account')).toBeTruthy()

  act(() => usePDMStore.getState().setLanguage('de'))
  expect(screen.getByText('Konto')).toBeTruthy()
})

it('opens a tab result without trying to reveal its navigation label in the page', () => {
  usePDMStore.setState({
    settingsSearchQuery: 'appearance',
    settingsFocusTarget: { tab: 'profile', label: 'Profile', nonce: 1 },
  })

  act(() => usePDMStore.getState().openSettingFromSearch('appearance'))

  expect(usePDMStore.getState().settingsTab).toBe('appearance')
  expect(usePDMStore.getState().settingsSearchQuery).toBe('')
  expect(usePDMStore.getState().settingsFocusTarget).toBeNull()
})

it('keeps the reveal target when opening a specific setting result', () => {
  act(() => usePDMStore.getState().openSettingFromSearch('appearance', 'Display Language'))

  expect(usePDMStore.getState().settingsFocusTarget).toMatchObject({
    tab: 'appearance',
    label: 'Display Language',
  })
})
