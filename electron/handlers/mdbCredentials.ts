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
}

export interface MdbServerSecrets {
  ftpPassword: string
  maintenanceToken: string
}

function credentialsDirectory(): string {
  return path.join(app.getPath('userData'), 'mdb-server')
}

function profilePath(): string {
  return path.join(credentialsDirectory(), 'profile.json')
}

function secretsPath(): string {
  return path.join(credentialsDirectory(), 'credentials.enc')
}

function assertProfile(profile: MdbServerProfile): void {
  if (!profile.ftpUrl || !profile.ftpRemotePath || !profile.ftpUsername) throw new Error('A complete FTPS profile is required.')
}

export async function saveMdbServerCredentials(profile: MdbServerProfile, secrets: MdbServerSecrets): Promise<void> {
  assertProfile(profile)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.')
  if (!secrets.ftpPassword || !secrets.maintenanceToken) throw new Error('Both deployment credentials are required.')
  const directory = credentialsDirectory()
  await fs.mkdir(directory, { recursive: true })
  const encrypted = safeStorage.encryptString(JSON.stringify(secrets)).toString('base64')
  await fs.writeFile(profilePath(), `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 })
  await fs.writeFile(secretsPath(), `${encrypted}\n`, { mode: 0o600 })
}

export async function readMdbServerCredentials(): Promise<{ profile: MdbServerProfile; secrets: MdbServerSecrets } | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const [profileRaw, encryptedRaw] = await Promise.all([
      fs.readFile(profilePath(), 'utf8'),
      fs.readFile(secretsPath(), 'utf8'),
    ])
    const profile = JSON.parse(profileRaw) as MdbServerProfile
    const decoded = safeStorage.decryptString(Buffer.from(encryptedRaw.trim(), 'base64'))
    const secrets = JSON.parse(decoded) as MdbServerSecrets
    assertProfile(profile)
    if (!secrets.ftpPassword || !secrets.maintenanceToken) return null
    return { profile, secrets }
  } catch {
    return null
  }
}

export async function getMdbServerCredentialState(): Promise<MdbServerCredentialState> {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  let profile: MdbServerProfile | null = null
  try {
    profile = JSON.parse(await fs.readFile(profilePath(), 'utf8')) as MdbServerProfile
    assertProfile(profile)
  } catch {
    profile = null
  }
  return {
    profile,
    hasCredentials: encryptionAvailable && (await readMdbServerCredentials()) !== null,
    encryptionAvailable,
  }
}

export async function clearMdbServerCredentials(): Promise<void> {
  await Promise.all([
    fs.rm(profilePath(), { force: true }),
    fs.rm(secretsPath(), { force: true }),
  ])
}

export function storedCredentialFilePathsForTests(): { profile: string; secrets: string } {
  return { profile: profilePath(), secrets: secretsPath() }
}
