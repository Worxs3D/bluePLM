import { SETTINGS_TABS, type SettingsTab } from '@/types/settings'

const SETTINGS_TAB_SET: ReadonlySet<string> = new Set(SETTINGS_TABS)

export function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === 'string' && SETTINGS_TAB_SET.has(value)
}

export function registerSettingsNavigationListener(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  actions: { setActiveView: (view: 'settings') => void; setSettingsTab: (tab: SettingsTab) => void },
): () => void {
  const listener = (event: Event) => applySettingsNavigationEvent(event, actions)
  target.addEventListener('navigate-settings-tab', listener)
  return () => target.removeEventListener('navigate-settings-tab', listener)
}

export function applySettingsNavigationEvent(
  event: Event,
  actions: { setActiveView: (view: 'settings') => void; setSettingsTab: (tab: SettingsTab) => void },
): boolean {
  const tab = (event as CustomEvent<unknown>).detail
  if (!isSettingsTab(tab)) return false
  actions.setSettingsTab(tab)
  actions.setActiveView('settings')
  return true
}
