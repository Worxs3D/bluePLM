import { app, ipcMain, safeStorage, WebContents } from 'electron'
import { createHash, generateKeyPairSync, sign } from 'crypto'
import fs from 'fs'
import path from 'path'

type StoredKey = { privateKey: string; publicKey: string }
const IPC_CHANNELS = ['backup-device:public-key'] as const
let cached: StoredKey | null = null

function assertTrustedSender(sender: WebContents): void {
  const url = sender.getURL()
  if (!url || (!url.startsWith('file://') && !url.startsWith('app://') && !url.startsWith('http://localhost'))) {
    throw new Error('Untrusted IPC sender')
  }
}

function keyPath(): string { return path.join(app.getPath('userData'), 'backup-device-key.bin') }

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

export function registerBackupDeviceHandlers(): void {
  ipcMain.handle(IPC_CHANNELS[0], (event) => { assertTrustedSender(event.sender); return getBackupDevicePublicKey() })
}

export function unregisterBackupDeviceHandlers(): void {
  for (const channel of IPC_CHANNELS) ipcMain.removeHandler(channel)
  cached = null
}

export function backupDeviceFingerprint(): string { return createHash('sha256').update(getBackupDevicePublicKey()).digest('hex') }
