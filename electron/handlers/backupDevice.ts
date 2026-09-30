import { app, ipcMain, safeStorage, WebContents } from 'electron'
import { createHash, generateKeyPairSync, sign } from 'crypto'
import fs from 'fs'
import path from 'path'

type StoredKey = { privateKey: string; publicKey: string }
type StoredMdbAuth = { serverUrl: string; accessToken: string }
const IPC_CHANNELS = ['backup-device:public-key', 'backup-device:sync-auth', 'backup-device:clear-auth', 'backup-device:designate'] as const
let cached: StoredKey | null = null
let cachedAuth: StoredMdbAuth | null = null

function assertTrustedSender(sender: WebContents): void {
  const rawUrl = sender.getURL()
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Error('Untrusted IPC sender') }
  const isTrusted = url.protocol === 'file:' || url.protocol === 'app:' ||
    (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname))
  if (!isTrusted) {
    throw new Error('Untrusted IPC sender')
  }
}

function keyPath(): string { return path.join(app.getPath('userData'), 'backup-device-key.bin') }
function authPath(): string { return path.join(app.getPath('userData'), 'backup-device-auth.bin') }

function normalizedServerUrl(raw: string): string {
  const url = new URL(raw)
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || (url.pathname !== '' && url.pathname !== '/')) throw new Error('Invalid MDB server URL')
  return url.origin
}

function machineId(): string {
  const os = require('os') as typeof import('os')
  return createHash('sha256').update(`${os.hostname()}-${os.cpus()[0]?.model ?? 'unknown'}-${process.platform}`).digest('hex').substring(0, 16)
}

function saveAuth(value: StoredMdbAuth): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.')
  const data = { serverUrl: normalizedServerUrl(value.serverUrl), accessToken: value.accessToken.trim() }
  if (!data.accessToken || data.accessToken.length > 1024) throw new Error('Invalid MDB session credential')
  fs.mkdirSync(path.dirname(authPath()), { recursive: true })
  fs.writeFileSync(authPath(), safeStorage.encryptString(JSON.stringify(data)), { mode: 0o600 })
  cachedAuth = data
}

function loadAuth(): StoredMdbAuth {
  if (cachedAuth) return cachedAuth
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.')
  const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(authPath()))) as StoredMdbAuth
  const data = { serverUrl: normalizedServerUrl(parsed.serverUrl), accessToken: String(parsed.accessToken ?? '').trim() }
  if (!data.accessToken) throw new Error('MDB backup session is unavailable')
  cachedAuth = data
  return data
}

function clearAuth(): void { cachedAuth = null; fs.rmSync(authPath(), { force: true }) }

function loadOrCreate(): StoredKey {
  if (cached) return cached
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.')
  const filename = keyPath()
  try {
    const raw = safeStorage.decryptString(fs.readFileSync(filename))
    const parsed = JSON.parse(raw) as StoredKey
    if (typeof parsed.privateKey !== 'string' || typeof parsed.publicKey !== 'string') throw new Error('invalid key')
    cached = parsed
    return parsed
  } catch {
    const pair = generateKeyPairSync('ed25519')
    const privateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url')
    const value = { privateKey, publicKey }
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 })
    cached = value
    return value
  }
}

export function getBackupDevicePublicKey(): string { return loadOrCreate().publicKey }

/** Signs the exact backend assertion. The renderer supplies only non-secret context. */
export function signBackupDeviceAssertion(fields: {
  method: string; endpoint: string; organizationId: string; userId: string
  machineId: string; keyVersion: number; challengeId: string; nonce: string
}): string {
  const payload = ['blueplm-backup-v1', fields.method, fields.endpoint, fields.organizationId,
    fields.userId, fields.machineId, fields.keyVersion, fields.challengeId, fields.nonce].join('|')
  return sign(null, Buffer.from(payload), loadOrCreate().privateKey).toString('base64url')
}

async function api<T>(auth: StoredMdbAuth, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json'); headers.set('Authorization', `Bearer ${auth.accessToken}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(new URL(path, `${auth.serverUrl}/`), { ...init, headers, cache: 'no-store' })
  const body = await response.json().catch(() => ({})) as T & { message?: string; error?: string }
  if (!response.ok) { if (response.status === 401) clearAuth(); throw new Error(body.message ?? body.error ?? 'MDB backup authorization failed') }
  return body
}

export type MdbBackupDeviceAction = 'heartbeat' | 'request' | 'start' | 'complete'

/**
 * Performs a device-authorized backup action entirely in main.  The renderer
 * can request an action, but neither the session nor its assertion crosses IPC.
 */
export async function performMdbBackupDeviceAction(endpoint: MdbBackupDeviceAction): Promise<void> {
  await resolveMdbBackupRuntime(endpoint)
}

export async function resolveMdbBackupRuntime(endpoint: 'runtime-config' | MdbBackupDeviceAction = 'runtime-config'): Promise<Record<string, unknown>> {
  const auth = loadAuth(); const deviceId = machineId()
  const challenge = await api<{ challengeId: string; nonce: string; keyVersion: number }>(auth, '/backup/device/challenge', { method: 'POST', body: JSON.stringify({ deviceId, endpoint }) })
  // The current backend signature canonically requires principal IDs. Fetching
  // them in main keeps both the session and the assertion out of renderer JS.
  const principal = await api<{ user: { userId: string; organizationId: string } }>(auth, '/auth/me')
  if (!principal.user.organizationId || !principal.user.userId) throw new Error('MDB principal is incomplete')
  const signed = signBackupDeviceAssertion({ method: endpoint === 'runtime-config' ? 'GET' : 'POST', endpoint, organizationId: principal.user.organizationId, userId: principal.user.userId, machineId: deviceId, keyVersion: challenge.keyVersion, challengeId: challenge.challengeId, nonce: challenge.nonce })
  if (endpoint === 'runtime-config') return api<{ config: Record<string, unknown> }>(auth, `/backup/runtime-config?machineId=${encodeURIComponent(deviceId)}`, { headers: { 'X-BluePLM-Device-Challenge': challenge.challengeId, 'X-BluePLM-Device-Signature': signed } }).then(v => v.config)
  return api(auth, `/backup/${endpoint}`, { method: 'POST', headers: { 'X-BluePLM-Device-Challenge': challenge.challengeId, 'X-BluePLM-Device-Signature': signed }, body: JSON.stringify({ machineId: deviceId }) })
}

export function registerBackupDeviceHandlers(): void {
  ipcMain.handle(IPC_CHANNELS[0], (event) => { assertTrustedSender(event.sender); return getBackupDevicePublicKey() })
  ipcMain.handle(IPC_CHANNELS[1], (event, value: StoredMdbAuth) => { assertTrustedSender(event.sender); saveAuth(value) })
  ipcMain.handle(IPC_CHANNELS[2], (event) => { assertTrustedSender(event.sender); clearAuth() })
  ipcMain.handle(IPC_CHANNELS[3], async (event, details: { machineName: string; platform: string }) => {
    assertTrustedSender(event.sender)
    const auth = loadAuth()
    await api(auth, '/backup/designate', { method: 'POST', body: JSON.stringify({ machineId: machineId(), machineName: details.machineName, platform: details.platform, publicKey: getBackupDevicePublicKey() }) })
  })
}

export function unregisterBackupDeviceHandlers(): void {
  for (const channel of IPC_CHANNELS) ipcMain.removeHandler(channel)
  cached = null
  cachedAuth = null
}

export function backupDeviceFingerprint(): string { return createHash('sha256').update(getBackupDevicePublicKey()).digest('hex') }
