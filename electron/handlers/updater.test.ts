import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, autoUpdater } = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  const listeners = new Map<string, Listener[]>()
  const updater = {
    on: (event: string, fn: Listener) =>
      listeners.set(event, [...(listeners.get(event) ?? []), fn]),
    emit: (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((fn) => fn(...args)),
    removeAllListeners: () => listeners.clear(),
    checkForUpdates: async () => {
      updater.emit('update-available', { version: '5.4.0', releaseDate: '2026-10-31' })
    },
    downloadUpdate: async () => {},
  }
  return { handlers: new Map<string, (...args: unknown[]) => unknown>(), autoUpdater: updater }
})

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => 'C:/nonexistent-userdata', getVersion: () => '5.3.0' },
  BrowserWindow: class {},
  shell: {},
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}))

vi.mock('electron-updater', () => ({ autoUpdater }))

type Updater = typeof import('./updater')

/** A fresh module, as a restart of the app would load it. */
async function startApp(): Promise<Updater> {
  autoUpdater.removeAllListeners()
  vi.resetModules()
  const updater = await import('./updater')
  loaded.push(updater)
  return updater
}

let loaded: Updater[] = []
const noLog = { log: () => {}, logError: () => {} }

type Sent = { channel: string; payload: { version: string; postponed?: boolean } }

function fakeWindow() {
  const sent: Sent[] = []
  const window = {
    webContents: {
      send: (channel: string, payload: Sent['payload']) => sent.push({ channel, payload }),
    },
    on: vi.fn(),
    removeListener: vi.fn(),
  }
  return { window, sent }
}

const available = (sent: Sent[]) => sent.filter((s) => s.channel === 'updater:available')

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const updater of loaded) {
    updater.cleanupUpdater()
    updater.unregisterUpdaterHandlers()
  }
  loaded = []
  vi.useRealTimers()
})

describe('update prompt after "Later"', () => {
  it('reports a postponed update without prompting, and a manual check prompts again', async () => {
    const { window, sent } = fakeWindow()
    ;(await startApp()).registerUpdaterHandlers(window as never, noLog)

    await vi.advanceTimersByTimeAsync(5000)
    expect(available(sent).at(-1)?.payload).toMatchObject({ version: '5.4.0', postponed: false })

    await handlers.get('updater:postpone')!({}, '5.4.0')
    const status = (await handlers.get('updater:get-status')!()) as {
      updateAvailable: Sent['payload'] | null
    }
    expect(status.updateAvailable).toMatchObject({ version: '5.4.0', postponed: true })

    await handlers.get('updater:check')!()
    expect(available(sent).at(-1)?.payload).toMatchObject({ postponed: false })
  })

  it('prompts again once the postponement is a day old, without a restart', async () => {
    const { window, sent } = fakeWindow()
    ;(await startApp()).registerUpdaterHandlers(window as never, noLog)
    await vi.advanceTimersByTimeAsync(5000)
    await handlers.get('updater:postpone')!({}, '5.4.0')
    const before = available(sent).length

    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000)
    expect(available(sent).length).toBe(before)

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 3 * 60 * 1000)
    expect(available(sent).length).toBe(before + 1)
    expect(available(sent).at(-1)?.payload).toMatchObject({ postponed: false })
  })

  it('forgets the postponement when the app starts again', async () => {
    const first = fakeWindow()
    const firstRun = await startApp()
    firstRun.registerUpdaterHandlers(first.window as never, noLog)
    await vi.advanceTimersByTimeAsync(5000)
    await handlers.get('updater:postpone')!({}, '5.4.0')
    firstRun.cleanupUpdater()
    firstRun.unregisterUpdaterHandlers()

    // Nothing about the postponement survives on disk into the next start.
    const second = fakeWindow()
    ;(await startApp()).registerUpdaterHandlers(second.window as never, noLog)
    await vi.advanceTimersByTimeAsync(5000)
    expect(available(second.sent).at(-1)?.payload).toMatchObject({ postponed: false })
  })
})
