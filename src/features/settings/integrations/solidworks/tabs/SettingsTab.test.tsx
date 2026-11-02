// @vitest-environment jsdom
/**
 * The embedded eDrawings preview mode is offered only when the main process says the native
 * preview can run (addon, host, .NET 8 Desktop Runtime, eDrawings). On a machine without the
 * runtime `edrawings:native-available` answers false, and the option must stay greyed out.
 * The runtime detection itself runs against a real Windows file system in
 * scripts/edrawings-ci/system-check.cjs.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../hooks', () => ({
  useSolidWorksSettings: () =>
    new Proxy(
      { cadPreviewMode: 'thumbnail', swComInstalls: [], solidworksProgId: null, isAdmin: true },
      {
        get: (defaults, property: string) => {
          if (property in defaults) return defaults[property as keyof typeof defaults]
          return /^(set|handle)/.test(property) ? vi.fn() : undefined
        },
      },
    ),
}))

import { SettingsTab } from './SettingsTab'

function embeddedOption(): HTMLButtonElement {
  const button = screen.getByText('solidworksSettings.embeddedEDrawings').closest('button')
  if (!button) throw new Error('The embedded eDrawings option is not a button')
  return button
}

function renderWithNativeAvailability(available: boolean) {
  const isEDrawingsNativeAvailable = vi.fn().mockResolvedValue(available)
  Object.defineProperty(window, 'electronAPI', {
    value: { isEDrawingsNativeAvailable },
    configurable: true,
  })
  render(<SettingsTab />)
  return isEDrawingsNativeAvailable
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'electronAPI')
})

describe('embedded eDrawings preview option', () => {
  it('is greyed out when the native preview is unavailable (no .NET 8 Desktop Runtime)', async () => {
    const check = renderWithNativeAvailability(false)
    await waitFor(() => expect(check).toHaveBeenCalledOnce())
    expect(embeddedOption().disabled).toBe(true)
  })

  it('can be chosen when the native preview is available', async () => {
    renderWithNativeAvailability(true)
    await waitFor(() => expect(embeddedOption().disabled).toBe(false))
  })
})
