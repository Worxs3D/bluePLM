import { afterEach, describe, expect, it, vi } from 'vitest'

import { isStructuredConsoleLog, log } from './logger'
import { forwardConsoleError, forwardConsoleWarning } from './consoleBridge'

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
      forwardConsoleWarning(args, { log: appLog, isStructured: isStructuredConsoleLog }, false)
    })

    log.warn('[Perf]', 'Long animation frame', { duration: 1000 })

    expect(appLog).toHaveBeenCalledOnce()
    expect(appLog).toHaveBeenCalledWith('warn', '[Perf] Long animation frame', { duration: 1000 })
  })

  it('forwards an external console Error once and keeps error tracking enabled', () => {
    const appLog = vi.fn()
    const trackError = vi.fn()
    const error = new Error('external failure')

    forwardConsoleError([error], { log: appLog, trackError, isStructured: () => false })

    expect(appLog).toHaveBeenCalledOnce()
    expect(trackError).toHaveBeenCalledOnce()
    expect(trackError).toHaveBeenCalledWith(error, { source: 'console.error' })
  })
})
