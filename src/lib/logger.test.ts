import { afterEach, describe, expect, it, vi } from 'vitest'

import { isStructuredConsoleLog, log } from './logger'

describe('logger error serialization', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('preserves an Error message when forwarding structured data to Electron', () => {
    const electronLog = vi.fn()
    vi.stubGlobal('window', { electronAPI: { log: electronLog } })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    log.error('[ItemDesignations]', 'Failed to load MDB item designations', {
      error: new Error('API route not found.'),
    })

    expect(electronLog).toHaveBeenCalledWith(
      'error',
      '[ItemDesignations] Failed to load MDB item designations',
      expect.objectContaining({
        error: expect.objectContaining({
          name: 'Error',
          message: 'API route not found.',
        }),
      }),
    )
  })
})

describe('structured logger console bridge', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('writes one app-log entry when console warnings are intercepted', () => {
    const appLog = vi.fn()
    vi.stubGlobal('window', { electronAPI: { log: appLog } })
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      if (!isStructuredConsoleLog()) appLog('warn', `[Console] ${String(args[0])}`)
    })

    log.warn('[Perf]', 'Long animation frame', { duration: 1000 })

    expect(appLog).toHaveBeenCalledOnce()
    expect(appLog).toHaveBeenCalledWith('warn', '[Perf] Long animation frame', { duration: 1000 })
  })
})
