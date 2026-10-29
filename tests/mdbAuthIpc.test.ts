import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { MdbAuthSnapshot } from '../electron/backend/mdbAuthAuthority'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  listeners: new Map<string, (event: unknown, value: unknown) => void>(),
  sender: {} as Record<string, unknown>,
  frame: { url: 'http://localhost:5173/' },
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => 'test', getAppPath: () => 'test' },
  dialog: { showMessageBox: vi.fn() },
  safeStorage: {},
  ipcMain: {
    handle: (name: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => {
      if (mocks.handlers.has(name)) throw new Error(`duplicate IPC handler: ${name}`)
      mocks.handlers.set(name, handler)
    },
    removeHandler: (name: string) => mocks.handlers.delete(name),
  },
  ipcRenderer: {
    invoke: (name: string, input: unknown) =>
      mocks.handlers.get(name)?.({ sender: mocks.sender, senderFrame: mocks.frame }, input),
    on: (name: string, listener: (event: unknown, value: unknown) => void) =>
      mocks.listeners.set(name, listener),
    removeListener: (name: string) => mocks.listeners.delete(name),
  },
}))
import { registerMdbAuthIpc } from '../electron/handlers/mdbAuthIpc'
import { createMdbAuthBridge } from '../electron/preloadMdbAuth'
import { resolveMdbBackend } from '../src/lib/backend'
import { MDB_PASSWORD_MAX_LENGTH } from '../electron/backend/mdbAuthTransport'

function fakeWindow() {
  const webContents = Object.assign(mocks.sender, {
    mainFrame: mocks.frame,
    send: (channel: string, value: unknown) => mocks.listeners.get(channel)?.({}, value),
  })
  let closed: (() => void) | undefined
  return {
    window: {
      webContents,
      isDestroyed: () => false,
      once: (_event: string, listener: () => void) => {
        closed = listener
      },
      removeListener: (_event: string, listener: () => void) => {
        if (closed === listener) closed = undefined
      },
    } as unknown as BrowserWindow,
    closedCallback: () => closed,
  }
}

describe('MDB explicit adapter through preload and Main IPC', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.listeners.clear()
  })
  it('runs a local fake transport end to end and rejects a foreign sender', async () => {
    const { window: win } = fakeWindow()
    let saved: MdbAuthSnapshot | null = null
    const persistence = {
      load: async () => saved,
      save: async (value: MdbAuthSnapshot) => {
        saved = value
      },
      clear: async () => {
        saved = null
      },
    }
    const principal = {
      userId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      email: 'a@example.test',
      displayName: 'A',
      role: 'member',
      createdAt: '2026-01-01T00:00:00Z',
    }
    const organization = {
      id: principal.organizationId,
      name: 'Org',
      slug: 'org',
      createdAt: principal.createdAt,
      documentManagerLicenseKey: 'private-license',
    }
    const fetchImpl = vi.fn(async (url: URL) => {
      if (url.pathname === '/health')
        return Response.json({ ok: true, runtime: 'php', supabase: false, apiVersion: 2 })
      if (url.pathname === '/auth/login')
        return Response.json({
          totpRequired: true,
          challengeToken: 'challenge-secret',
          expiresAt: '2099-01-01T00:00:00Z',
        })
      if (url.pathname === '/auth/totp/verify')
        return Response.json({ token: 'bearer-secret', expiresAt: '2099-01-01T00:00:00Z' })
      if (url.pathname === '/auth/me') return Response.json({ user: principal })
      if (url.pathname === '/organizations/current') return Response.json({ organization })
      throw Error('unexpected request')
    })
    const dispose = registerMdbAuthIpc(win, {
      persistence,
      fetchImpl,
      confirmServer: async () => true,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    const backend = resolveMdbBackend(createMdbAuthBridge())
    const events: unknown[] = []
    const unsubscribe = backend.auth.subscribe((event) => events.push(event))
    expect(
      await backend.auth.signIn({ serverUrl: 'https://example.test/', email: 'a', password: 'b' }),
    ).toEqual({ ok: true, state: { status: 'totp-required' } })
    const verified = await backend.auth.verifyTotp('123456')
    expect(verified).toMatchObject({ ok: true, state: { status: 'verified' } })
    expect(JSON.stringify([verified, events])).not.toMatch(/secret|private-license/)
    const foreign = await mocks.handlers.get('mdb-auth:get-state')?.(
      { sender: {}, senderFrame: mocks.frame } as unknown as IpcMainInvokeEvent,
      undefined,
    )
    expect(foreign).toMatchObject({ ok: false, code: 'invalid-sender' })
    const malformed = await mocks.handlers.get('mdb-auth:sign-in')?.(
      { sender: mocks.sender, senderFrame: mocks.frame },
      { serverUrl: 'https://example.test/', email: 'a', password: 'b', role: 'admin' },
    )
    expect(malformed).toMatchObject({ ok: false, code: 'invalid-input' })
    expect(await backend.auth.signOut()).toEqual({ ok: true, state: { status: 'signed-out' } })
    unsubscribe()
    dispose()
  })
  it('disposes the old window before reopening and ignores its late close callback', async () => {
    const first = fakeWindow()
    const second = fakeWindow()
    const persistence = { load: async () => null, save: async () => {}, clear: async () => {} }
    const fetchImpl = vi.fn(async () => Response.json({}))
    const options = { persistence, fetchImpl, confirmServer: async () => true }
    const oldDispose = registerMdbAuthIpc(first.window, options)
    const oldClosed = first.closedCallback()
    const newDispose = registerMdbAuthIpc(second.window, options)
    expect(mocks.handlers.size).toBe(6)
    oldClosed?.()
    oldDispose()
    expect(mocks.handlers.size).toBe(6)
    expect(await createMdbAuthBridge().getState()).toEqual({
      ok: true,
      state: { status: 'signed-out' },
    })
    second.closedCallback()?.()
    expect(mocks.handlers.size).toBe(0)
    newDispose()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('rejects oversized passwords before any request and preserves the maximum length password', async () => {
    const { window } = fakeWindow()
    const fetchImpl = vi.fn(async (url: URL) =>
      url.pathname.endsWith('/health')
        ? Response.json({ ok: true, runtime: 'php', supabase: false, apiVersion: 2 })
        : Response.json({
            totpRequired: true,
            challengeToken: 'synthetic',
            expiresAt: '2099-01-01T00:00:00Z',
          }),
    )
    const dispose = registerMdbAuthIpc(window, {
      persistence: { load: async () => null, save: async () => {}, clear: async () => {} },
      fetchImpl,
      confirmServer: async () => true,
    })
    const bridge = createMdbAuthBridge()
    expect(
      await bridge.signIn({
        serverUrl: 'https://example.test/',
        email: 'a',
        password: 'x'.repeat(MDB_PASSWORD_MAX_LENGTH + 1),
      }),
    ).toMatchObject({ ok: false, code: 'invalid-input' })
    expect(fetchImpl).not.toHaveBeenCalled()
    const password = ` ${'x'.repeat(MDB_PASSWORD_MAX_LENGTH - 2)} `
    expect(
      await bridge.signIn({ serverUrl: 'https://example.test/', email: 'a', password }),
    ).toEqual({ ok: true, state: { status: 'totp-required' } })
    const request = fetchImpl.mock.calls[1] as unknown as [URL, RequestInit]
    expect(JSON.parse(String(request[1].body)).password).toBe(password)
    dispose()
  })
})
