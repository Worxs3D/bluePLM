import { app, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { Client } from 'basic-ftp'
import {
  activateRemoteDeployment,
  finalizeRemoteDeployment,
  ftpAccessOptions,
  ftpBase,
  installerBridge,
  installerRequest,
  listFiles,
  removeRemoteDirectory,
  removeRemoteFile,
  rollbackRemoteDeployment,
  serverBundleRoot,
  upload,
  type MdbFtpsSecurity,
  type RemoteDeploymentActivation,
} from './mdbInstaller'
import { createMdbBundleManifest, MDB_BUNDLE_MANIFEST_FILE, serializeMdbBundleManifest, type MdbBundleManifest } from './mdbBundle'
import { clearMdbServerCredentials, getMdbServerCredentialState, readMdbServerCredentials, saveMdbServerCredentials, type MdbServerCredentialState, type MdbServerProfile } from './mdbCredentials'

export type MdbServerUpdateStatus = 'current' | 'update-available' | 'unknown' | 'updating' | 'rollback' | 'failure'

export interface MdbServerHealth {
  ok: boolean
  supabase: boolean
  apiVersion: number | null
  bundleVersion: number | null
  bundleDigest: string | null
  bundleFileCount: number | null
}

export interface MdbServerUpdateInspection {
  status: Exclude<MdbServerUpdateStatus, 'updating' | 'rollback' | 'failure'>
  packaged: MdbBundleManifest
  deployed: Pick<MdbServerHealth, 'bundleVersion' | 'bundleDigest' | 'bundleFileCount'> | null
  credentials: MdbServerCredentialState
}

export interface MdbServerUpdateRequest {
  serverUrl: string
  sessionToken: string
  organizationId: string
  confirmed: boolean
}

export interface MdbServerUpdateResult {
  success: boolean
  status: MdbServerUpdateStatus
  inspection?: MdbServerUpdateInspection
  errorCode?: 'NOT_AUTHORIZED' | 'CREDENTIALS_UNAVAILABLE' | 'CONFIRMATION_REQUIRED' | 'MAINTENANCE_TOKEN_REJECTED' | 'DEPLOYMENT_FAILED' | 'HEALTH_MISMATCH' | 'UNAVAILABLE'
}

interface HealthResponse {
  ok?: unknown
  supabase?: unknown
  apiVersion?: unknown
  bundleVersion?: unknown
  bundleDigest?: unknown
  bundleFileCount?: unknown
}

function safeServerUrl(raw: string): URL {
  const url = new URL(raw)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('UNAVAILABLE')
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('UNAVAILABLE')
  return new URL(url.toString().replace(/\/$/, ''))
}

function normalizeHealth(body: HealthResponse): MdbServerHealth {
  return {
    ok: body.ok === true,
    supabase: body.supabase === true,
    apiVersion: Number.isInteger(body.apiVersion) ? Number(body.apiVersion) : null,
    bundleVersion: Number.isInteger(body.bundleVersion) ? Number(body.bundleVersion) : null,
    bundleDigest: typeof body.bundleDigest === 'string' && /^[a-f0-9]{64}$/.test(body.bundleDigest) ? body.bundleDigest : null,
    bundleFileCount: Number.isInteger(body.bundleFileCount) ? Number(body.bundleFileCount) : null,
  }
}

async function fetchHealth(serverUrl: string): Promise<MdbServerHealth> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(new URL('/health', `${safeServerUrl(serverUrl).toString()}/`), { signal: controller.signal, cache: 'no-store' })
    if (!response.ok) throw new Error('UNAVAILABLE')
    return normalizeHealth(await response.json() as HealthResponse)
  } finally {
    clearTimeout(timer)
  }
}

export function classifyMdbServerUpdate(packaged: MdbBundleManifest, deployed: Pick<MdbServerHealth, 'bundleVersion' | 'bundleDigest' | 'bundleFileCount'> | null): MdbServerUpdateInspection['status'] {
  if (!deployed?.bundleDigest || deployed.bundleVersion !== 1) return 'unknown'
  return deployed.bundleDigest === packaged.digest ? 'current' : 'update-available'
}

export async function inspectMdbServerUpdate(serverUrl: string): Promise<MdbServerUpdateInspection> {
  const packaged = await createMdbBundleManifest(serverBundleRoot())
  const credentials = await getMdbServerCredentialState()
  try {
    const health = await fetchHealth(serverUrl)
    const deployed = {
      bundleVersion: health.bundleVersion,
      bundleDigest: health.bundleDigest,
      bundleFileCount: health.bundleFileCount,
    }
    return { status: classifyMdbServerUpdate(packaged, deployed), packaged, deployed, credentials }
  } catch {
    return { status: 'unknown', packaged, deployed: null, credentials }
  }
}

export async function assertOwnerOrAdmin(serverUrl: string, sessionToken: string, organizationId: string): Promise<void> {
  if (!sessionToken || !organizationId) throw new Error('NOT_AUTHORIZED')
  const response = await fetch(new URL('/auth/me', `${safeServerUrl(serverUrl).toString()}/`), {
    headers: { Authorization: `Bearer ${sessionToken}` },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('NOT_AUTHORIZED')
  const body = await response.json() as { user?: { organizationId?: unknown; role?: unknown } }
  if (body.user?.organizationId !== organizationId || !['owner', 'admin'].includes(String(body.user?.role))) throw new Error('NOT_AUTHORIZED')
}

type UpdateDeploymentClient = Pick<Client, 'access' | 'cd' | 'ensureDir' | 'list' | 'removeDir' | 'rename'>

async function stageBundle(
  ftp: URL,
  security: MdbFtpsSecurity,
  remoteRoot: string,
  ftpUsername: string,
  ftpPassword: string,
  bundleRoot: string,
): Promise<{ bridgeName: string; bridgeRemote: string; manifest: MdbBundleManifest; cleanup: () => Promise<void> }> {
  const nonce = randomBytes(12).toString('hex')
  const stageName = `blueplm-stage-${nonce}`
  const bridgeName = `blueplm-installer-${nonce}.php`
  const resolvedStageRoot = [remoteRoot, stageName].filter(Boolean).join('/')
  const bridgeRemote = [remoteRoot, 'public', bridgeName].filter(Boolean).join('/')
  const temp = await fs.mkdtemp(path.join(app.getPath('temp'), 'blueplm-mdb-update-'))
  const bridgePath = path.join(temp, bridgeName)
  const manifestPath = path.join(temp, MDB_BUNDLE_MANIFEST_FILE)
  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    await removeRemoteFile(ftp, security, bridgeRemote, ftpUsername, ftpPassword).catch(() => undefined)
    await removeRemoteDirectory(ftp, security, resolvedStageRoot, ftpUsername, ftpPassword).catch(() => undefined)
    await fs.rm(temp, { recursive: true, force: true })
  }
  try {
    const files = (await Promise.all(['src', 'public', 'migrations'].map((folder) => listFiles(path.join(bundleRoot, folder))))).flat()
    for (const file of files) {
      const relative = path.relative(bundleRoot, file).replaceAll('\\', '/')
      await upload(ftp, security, `${resolvedStageRoot}/${relative}`, file, ftpUsername, ftpPassword)
    }
    const manifest = await createMdbBundleManifest(bundleRoot)
    await fs.writeFile(manifestPath, serializeMdbBundleManifest(manifest), { mode: 0o600 })
    await upload(ftp, security, `${resolvedStageRoot}/${MDB_BUNDLE_MANIFEST_FILE}`, manifestPath, ftpUsername, ftpPassword)
    await fs.writeFile(bridgePath, installerBridge(stageName), { mode: 0o600 })
    await upload(ftp, security, bridgeRemote, bridgePath, ftpUsername, ftpPassword)
    return { bridgeName, bridgeRemote, manifest, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

export interface MdbServerUpdatePlanOperations {
  migrate: () => Promise<void>
  activate: () => Promise<RemoteDeploymentActivation>
  verifyHealth: () => Promise<boolean>
  finalize: (activation: RemoteDeploymentActivation) => Promise<void>
  rollback: (activation: RemoteDeploymentActivation) => Promise<void>
  cleanup: () => Promise<void>
}

/**
 * Runs the destructive part of an update behind one seam. A database migration
 * can outlive a file rollback; migrations must therefore be backward-compatible
 * with the previous bundle. The live .env is never part of activation.
 */
export async function executeMdbServerUpdatePlan(ops: MdbServerUpdatePlanOperations): Promise<MdbServerUpdateResult> {
  let activation: RemoteDeploymentActivation | undefined
  try {
    await ops.migrate()
    activation = await ops.activate()
    if (!(await ops.verifyHealth())) {
      await ops.rollback(activation)
      return { success: false, status: 'rollback', errorCode: 'HEALTH_MISMATCH' }
    }
    await ops.finalize(activation)
    return { success: true, status: 'current' }
  } catch (error) {
    if (activation) await ops.rollback(activation).catch(() => undefined)
    const message = error instanceof Error ? error.message : ''
    return {
      success: false,
      status: activation ? 'rollback' : 'failure',
      errorCode: /maintenance|migration token/i.test(message) ? 'MAINTENANCE_TOKEN_REJECTED' : 'DEPLOYMENT_FAILED',
    }
  } finally {
    await ops.cleanup().catch(() => undefined)
  }
}

export async function applyMdbServerUpdate(request: MdbServerUpdateRequest): Promise<MdbServerUpdateResult> {
  if (!request.confirmed) return { success: false, status: 'failure', errorCode: 'CONFIRMATION_REQUIRED' }
  try {
    await assertOwnerOrAdmin(request.serverUrl, request.sessionToken, request.organizationId)
  } catch {
    return { success: false, status: 'failure', errorCode: 'NOT_AUTHORIZED' }
  }
  const stored = await readMdbServerCredentials()
  if (!stored) return { success: false, status: 'failure', errorCode: 'CREDENTIALS_UNAVAILABLE' }
  let cleanup: (() => Promise<void>) | undefined
  let activation: RemoteDeploymentActivation | undefined
  let client: UpdateDeploymentClient | undefined
  try {
    const ftp = ftpBase(stored.profile.ftpUrl, stored.profile.ftpSecurity)
    const bundleRoot = serverBundleRoot()
    const stage = await stageBundle(ftp, stored.profile.ftpSecurity, stored.profile.ftpRemotePath, stored.profile.ftpUsername, stored.secrets.ftpPassword, bundleRoot)
    cleanup = stage.cleanup
    client = new Client(30_000)
    client.ftp.verbose = false
    await client.access({ ...ftpAccessOptions(ftp, stored.profile.ftpSecurity), user: stored.profile.ftpUsername, password: stored.secrets.ftpPassword })
    const base = ftp.pathname.replace(/\/$/, '')
    const targetRoot = `${base}/${stored.profile.ftpRemotePath}`.replaceAll('//', '/')
    const stageRoot = `${base}/${stored.profile.ftpRemotePath}/${stage.bridgeName.replace('blueplm-installer-', 'blueplm-stage-').replace('.php', '')}`.replaceAll('//', '/')
    const plan = await executeMdbServerUpdatePlan({
      migrate: async () => {
        const migrate = await installerRequest<{ applied?: string[] }>(request.serverUrl, stage.bridgeName, '/admin/migrate', { maintenanceToken: stored.secrets.maintenanceToken })
        if (!Array.isArray(migrate.applied)) throw new Error('MAINTENANCE_TOKEN_REJECTED')
      },
      activate: async () => {
        activation = await activateRemoteDeployment(client!, targetRoot, stageRoot, false, true)
        return activation
      },
      verifyHealth: async () => {
        const health = await fetchHealth(request.serverUrl)
        return health.bundleDigest === stage.manifest.digest && health.bundleVersion === stage.manifest.version
      },
      finalize: (current) => finalizeRemoteDeployment(client!, current),
      rollback: (current) => rollbackRemoteDeployment(client!, current),
      cleanup: stage.cleanup,
    })
    cleanup = undefined
    return plan
  } catch (error) {
    if (activation && client) await rollbackRemoteDeployment(client, activation).catch(() => undefined)
    const code = error instanceof Error ? error.message : ''
    return { success: false, status: activation ? 'rollback' : 'failure', errorCode: code === 'MAINTENANCE_TOKEN_REJECTED' ? 'MAINTENANCE_TOKEN_REJECTED' : 'DEPLOYMENT_FAILED' }
  } finally {
    client?.close()
    await cleanup?.()
  }
}

export function registerMdbServerUpdateHandlers(): void {
  ipcMain.handle('mdb-server:inspect-update', async (_event, serverUrl: string) => inspectMdbServerUpdate(serverUrl))
  ipcMain.handle('mdb-server:apply-update', async (_event, request: MdbServerUpdateRequest) => applyMdbServerUpdate(request))
  ipcMain.handle('mdb-server:get-credentials', async () => getMdbServerCredentialState())
  ipcMain.handle('mdb-server:save-credentials', async (_event, profile: MdbServerProfile, secrets: { ftpPassword: string; maintenanceToken: string }) => {
    await saveMdbServerCredentials(profile, secrets)
    return getMdbServerCredentialState()
  })
  ipcMain.handle('mdb-server:clear-credentials', async () => {
    await clearMdbServerCredentials()
    return getMdbServerCredentialState()
  })
}

export function unregisterMdbServerUpdateHandlers(): void {
  ipcMain.removeHandler('mdb-server:inspect-update')
  ipcMain.removeHandler('mdb-server:apply-update')
  ipcMain.removeHandler('mdb-server:get-credentials')
  ipcMain.removeHandler('mdb-server:save-credentials')
  ipcMain.removeHandler('mdb-server:clear-credentials')
}
