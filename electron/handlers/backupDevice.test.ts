import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPublicKey, verify } from 'node:crypto'

const state = vi.hoisted(() => ({ root: '', handlers: new Map<string, Function>(), encrypted: [] as string[] }))
vi.mock('electron', () => ({
  app: { getPath: () => state.root },
  ipcMain: { handle: (channel: string, handler: Function) => state.handlers.set(channel, handler), removeHandler: (channel: string) => state.handlers.delete(channel) },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => { state.encrypted.push(value); return Buffer.from(value, 'utf8').toString('base64url') }, decryptString: (value: Buffer) => Buffer.from(value.toString('utf8'), 'base64url').toString('utf8') },
}))

async function subject() {
  vi.resetModules()
  return import('./backupDevice')
}
const sender = (url = 'file:///app/index.html') => ({ sender: { getURL: () => url } })

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'blueplm-backup-device-'))
  state.handlers.clear(); state.encrypted = []
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(async () => { vi.unstubAllGlobals(); await fs.rm(state.root, { recursive: true, force: true }) })

describe('MDB backup device boundary', () => {
  it('persists device key and MDB session only through safeStorage and reloads the public key', async () => {
    const first = await subject()
    first.registerBackupDeviceHandlers()
    const publicKey = await state.handlers.get('backup-device:public-key')!(sender())
    await state.handlers.get('backup-device:sync-auth')!(sender(), { serverUrl: 'https://mdb.example.test', accessToken: 'session-secret' })
    expect(state.encrypted.join('\n')).toContain('session-secret')
    const authFile = await fs.readFile(path.join(state.root, 'backup-device-auth.bin'), 'utf8')
    expect(authFile).not.toContain('session-secret')
    first.unregisterBackupDeviceHandlers()
    const reloaded = await subject()
    expect(reloaded.getBackupDevicePublicKey()).toBe(publicKey)
  })

  it('rejects hostile IPC senders and permits only packaged or loopback development origins', async () => {
    const device = await subject(); device.registerBackupDeviceHandlers()
    const getKey = state.handlers.get('backup-device:public-key')!
    expect(() => getKey(sender('https://attacker.test'))).toThrow('Untrusted IPC sender')
    expect(() => getKey(sender('http://localhost.evil.test'))).toThrow('Untrusted IPC sender')
    expect(getKey(sender('http://127.0.0.1:5173'))).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('enforces HTTPS except for loopback and clears the persisted session explicitly', async () => {
    const device = await subject(); device.registerBackupDeviceHandlers()
    const sync = state.handlers.get('backup-device:sync-auth')!
    expect(() => sync(sender(), { serverUrl: 'http://mdb.example.test', accessToken: 'x' })).toThrow('Invalid MDB server URL')
    await sync(sender(), { serverUrl: 'http://localhost:8080', accessToken: 'x' })
    expect(await fs.stat(path.join(state.root, 'backup-device-auth.bin'))).toBeTruthy()
    await state.handlers.get('backup-device:clear-auth')!(sender())
    await expect(fs.stat(path.join(state.root, 'backup-device-auth.bin'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses the canonical challenge signing context and never returns runtime credentials to IPC', async () => {
    const device = await subject()
    const publicKey = device.getBackupDevicePublicKey()
    const signature = device.signBackupDeviceAssertion({ method: 'GET', endpoint: 'runtime-config', organizationId: 'org', userId: 'user', machineId: 'machine', keyVersion: 2, challengeId: 'challenge', nonce: 'nonce' })
    const pem = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'base64url')]), format: 'der', type: 'spki' })
    expect(verify(null, Buffer.from('blueplm-backup-v1|GET|runtime-config|org|user|machine|2|challenge|nonce'), pem, Buffer.from(signature, 'base64url'))).toBe(true)
    expect(Object.keys(state.handlers)).not.toContain('privateKey')
    expect(device.resolveMdbBackupRuntime.toString()).not.toContain('ipcMain.handle')
  })

  it('clears the session after a 401 and keeps credentials out of the failure surface', async () => {
    const device = await subject(); device.registerBackupDeviceHandlers()
    await state.handlers.get('backup-device:sync-auth')!(sender(), { serverUrl: 'https://mdb.example.test', accessToken: 'session-secret' })
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'unauthorized' }) } as Response)
    await expect(device.resolveMdbBackupRuntime()).rejects.toThrow('unauthorized')
    await expect(fs.stat(path.join(state.root, 'backup-device-auth.bin'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.stringify(state.encrypted)).not.toContain('private-key')
  })
})
