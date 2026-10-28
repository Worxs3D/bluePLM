import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))

import { handleDeepLink, parseDeepLink } from './deepLink'

describe('parseDeepLink', () => {
  it('accepts a manifest id and a semantic version', () => {
    const parsed = parseDeepLink('blueplm://install/acme.tool?version=1.2.3')
    expect(parsed).toMatchObject({ action: 'install', extensionId: 'acme.tool', version: '1.2.3' })
    expect(parsed.error).toBeUndefined()
  })

  it('accepts the Windows form without //', () => {
    expect(parseDeepLink('blueplm:install/acme.tool').extensionId).toBe('acme.tool')
  })

  it.each([
    'blueplm://install/..%2F..%2Fetc.passwd',
    'blueplm://install/Acme.Tool',
    'blueplm://install/no-dot',
    'blueplm://install/a.b.c',
    'blueplm://install/%3Cscript%3E.x',
  ])('refuses an invalid id in %s', (url) => {
    const parsed = parseDeepLink(url)
    expect(parsed.extensionId).toBeUndefined()
    expect(parsed.error).toBe('Invalid extension ID')
  })

  it.each(['latest', '1.0', '1.0.0/../../x', ''])('refuses version %j', (version) => {
    const parsed = parseDeepLink(
      `blueplm://install/acme.tool?version=${encodeURIComponent(version)}`,
    )
    expect(parsed.extensionId).toBeUndefined()
    expect(parsed.version).toBeUndefined()
    expect(parsed.error).toBe('Invalid version')
  })
})

describe('handleDeepLink', () => {
  it('returns a failure for an invalid id and never reaches the window', async () => {
    const result = await handleDeepLink('blueplm://install/../../evil')
    expect(result.success).toBe(false)
  })

  it('returns the parse error for an invalid version', async () => {
    const result = await handleDeepLink('blueplm://install/acme.tool?version=nope')
    expect(result).toMatchObject({ success: false, action: 'install', error: 'Invalid version' })
  })
})
