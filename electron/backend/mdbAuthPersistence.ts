import * as fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MdbAuthPersistence, MdbAuthSnapshot } from './mdbAuthAuthority'
import { parsePrincipal, parseOrganization } from './mdbAuthParsers'
import { normalizeMdbServerUrl } from './mdbAuthTransport'

/** Auth-only record storage extracted from c8eb49c5 mdbDurableEncryptedRecordStore. */
export interface MdbEncryptedAuthRecordStore {
  read(): Promise<Uint8Array | null>
  write(value: Uint8Array): Promise<void>
  clear(): Promise<void>
}

export function createMdbEncryptedAuthRecordStore(filePath: string): MdbEncryptedAuthRecordStore {
  return {
    async read() {
      try {
        return new Uint8Array(await fs.readFile(filePath))
      } catch (error) {
        if (isMissingFile(error)) return null
        throw error
      }
    },
    async write(value) {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temporaryPath, value, { mode: 0o600, flag: 'wx' })
        await fs.rename(temporaryPath, filePath)
      } finally {
        await fs.rm(temporaryPath, { force: true })
      }
    },
    async clear() {
      try {
        await fs.unlink(filePath)
      } catch (error) {
        if (!isMissingFile(error)) throw error
      }
      try {
        await fs.access(filePath)
      } catch (error) {
        if (isMissingFile(error)) return
        throw error
      }
      throw new Error('MDB encrypted auth record remains after clear')
    },
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/** Electron safeStorage boundary based on f86da500 createSafeStorageMdbTrustedContextPersistence. */
export function createSafeStorageMdbAuthPersistence(
  safeStorage: {
    isEncryptionAvailable(): boolean
    encryptString(value: string): Buffer
    decryptString(value: Buffer): string
  },
  store: MdbEncryptedAuthRecordStore,
): MdbAuthPersistence {
  return {
    async load() {
      if (!safeStorage.isEncryptionAvailable()) return null
      const bytes = await store.read()
      if (bytes === null) return null
      try {
        const value: unknown = JSON.parse(safeStorage.decryptString(Buffer.from(bytes)))
        if (typeof value !== 'object' || value === null || Array.isArray(value))
          throw new Error('invalid snapshot')
        const record = value as Record<string, unknown>
        if (
          typeof record.serverUrl !== 'string' ||
          typeof record.bearerToken !== 'string' ||
          !record.bearerToken.trim() ||
          typeof record.expiresAt !== 'string' ||
          !Number.isFinite(Date.parse(record.expiresAt))
        )
          throw new Error('invalid snapshot')
        const result: MdbAuthSnapshot = {
          serverUrl: normalizeMdbServerUrl(record.serverUrl).toString(),
          bearerToken: record.bearerToken,
          expiresAt: record.expiresAt,
          principal: parsePrincipal({ user: record.principal }),
          organization: parseOrganization({ organization: record.organization }),
        }
        if (result.organization.id !== result.principal.organizationId)
          throw new Error('invalid identity')
        return result
      } catch {
        await store.clear()
        return null
      }
    },
    async save(snapshot) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('encryption unavailable')
      await store.write(safeStorage.encryptString(JSON.stringify(snapshot)))
    },
    clear: () => store.clear(),
  }
}
