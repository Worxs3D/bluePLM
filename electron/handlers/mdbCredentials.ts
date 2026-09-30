import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface MdbServerProfile {
  ftpUrl: string
  ftpSecurity: 'explicit' | 'implicit'
  ftpRemotePath: string
  ftpUsername: string
}

export interface MdbServerCredentialState {
  profile: MdbServerProfile | null
  hasCredentials: boolean
  encryptionAvailable: boolean
  boundServerUrl: string | null
  boundOrganizationId: string | null
}

export interface MdbServerCredentialBinding {
  serverUrl: string
  organizationId: string
}

export interface MdbServerSecrets {
  ftpPassword: string
  maintenanceToken: string
}

function credentialsDirectory(): string {
  return path.join(app.getPath('userData'), 'mdb-server')
}

function secretsPath(): string {
  return path.join(credentialsDirectory(), 'credentials.enc')
}

export function normalizeMdbServerUrl(raw: string): string {
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new Error('UNAVAILABLE') }
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) || url.username || url.password || url.search || url.hash || (url.pathname !== '' && url.pathname !== '/')) throw new Error('UNAVAILABLE')
  return url.origin
}

function assertProfile(profile: MdbServerProfile): void {
  let ftp: URL
  try { ftp = new URL(profile.ftpUrl) } catch { throw new Error('INVALID_PROFILE') }
  if (ftp.protocol !== 'ftps:' || ftp.username || ftp.password || ftp.search || ftp.hash || (ftp.port && !['21', '990'].includes(ftp.port)) || !profile.ftpRemotePath.startsWith('/') || profile.ftpRemotePath.includes('..') || !profile.ftpUsername || /[\r\n\0]/u.test(profile.ftpRemotePath) || /[\r\n\0]/u.test(profile.ftpUsername) || !['explicit', 'implicit'].includes(profile.ftpSecurity)) throw new Error('INVALID_PROFILE')
}

interface StoredCredentials {
  profile: MdbServerProfile
  binding: MdbServerCredentialBinding
  secrets: MdbServerSecrets
}

export async function saveMdbServerCredentials(profile: MdbServerProfile, secrets: MdbServerSecrets, binding: MdbServerCredentialBinding): Promise<void> {
  assertProfile(profile)
  const normalizedBinding = { serverUrl: normalizeMdbServerUrl(binding.serverUrl), organizationId: binding.organizationId.trim() }
  if (!normalizedBinding.organizationId) throw new Error('INVALID_PROFILE')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.')
  if (!secrets.ftpPassword || !secrets.maintenanceToken) throw new Error('Both deployment credentials are required.')
  const directory = credentialsDirectory()
  await fs.mkdir(directory, { recursive: true })
  const encrypted = safeStorage.encryptString(JSON.stringify({ profile, binding: normalizedBinding, secrets } satisfies StoredCredentials)).toString('base64')
  await fs.writeFile(secretsPath(), `${encrypted}\n`, { mode: 0o600 })
}

export async function readMdbServerCredentials(): Promise<{ profile: MdbServerProfile; secrets: MdbServerSecrets; binding: MdbServerCredentialBinding } | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const encryptedRaw = await fs.readFile(secretsPath(), 'utf8')
    const stored = JSON.parse(safeStorage.decryptString(Buffer.from(encryptedRaw.trim(), 'base64'))) as StoredCredentials
    const profile = stored.profile
    const secrets = stored.secrets
    assertProfile(profile)
    if (!secrets.ftpPassword || !secrets.maintenanceToken) return null
    const binding = { serverUrl: normalizeMdbServerUrl(stored.binding.serverUrl), organizationId: stored.binding.organizationId }
    return { profile, secrets, binding }
  } catch {
    return null
  }
}

export async function getMdbServerCredentialState(): Promise<MdbServerCredentialState> {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  let binding: MdbServerCredentialBinding | null = null
  try {
    const stored = await readMdbServerCredentials()
    binding = stored?.binding ?? null
  } catch {
    binding = null
  }
  return {
    // Deployment profile fields stay inside the encrypted main-process record.
    // The renderer only needs to know whether credentials are available.
    profile: null,
    hasCredentials: encryptionAvailable && (await readMdbServerCredentials()) !== null,
    encryptionAvailable,
    boundServerUrl: binding?.serverUrl ?? null,
    boundOrganizationId: binding?.organizationId ?? null,
  }
}

export async function clearMdbServerCredentials(binding?: MdbServerCredentialBinding): Promise<void> {
  if (binding) {
    const stored = await readMdbServerCredentials()
    if (!stored || stored.binding.serverUrl !== normalizeMdbServerUrl(binding.serverUrl) || stored.binding.organizationId !== binding.organizationId) throw new Error('CREDENTIAL_BINDING_MISMATCH')
  }
  await Promise.all([
    fs.rm(secretsPath(), { force: true }),
  ])
}

export function storedCredentialFilePathsForTests(): { profile: string; secrets: string } {
  return { profile: secretsPath(), secrets: secretsPath() }
}
