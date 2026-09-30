import { app, dialog, ipcMain } from 'electron'
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
  RemoteRollbackError,
} from './mdbInstaller'
import { createMdbBundleManifest, MDB_BUNDLE_MANIFEST_FILE, serializeMdbBundleManifest, type MdbBundleManifest } from './mdbBundle'
import { clearMdbServerCredentials, getMdbServerCredentialState, normalizeMdbServerUrl, readMdbServerCredentials, saveMdbServerCredentials, type MdbServerCredentialBinding, type MdbServerProfile } from './mdbCredentials'

export type MdbServerUpdateStatus = 'current' | 'update-available' | 'server-newer' | 'same-version-different' | 'unknown' | 'updating' | 'rollback' | 'failure'

export interface MdbServerHealth {
  ok: boolean
  supabase: boolean
  apiVersion: number | null
  bundleVersion: number | null
  bundleReleaseVersion: string | null
  bundleDigest: string | null
  bundleFileCount: number | null
}

export interface MdbServerUpdateInspection {
  status: Exclude<MdbServerUpdateStatus, 'updating' | 'rollback' | 'failure'>
  packaged: MdbBundleManifest
  deployed: Pick<MdbServerHealth, 'bundleVersion' | 'bundleReleaseVersion' | 'bundleDigest' | 'bundleFileCount'> | null
}

export interface MdbServerUpdateRequest {
  serverUrl: string
  sessionToken: string
  organizationId: string
  locale?: string
}

export interface MdbServerCredentialRequest extends MdbServerCredentialBinding {
  sessionToken: string
  locale?: string
}

type ConfirmationKind = 'update' | 'save' | 'replace' | 'clear'
let confirmationForTests: ((kind: ConfirmationKind, text: { message: string; confirmLabel: string; cancelLabel: string }) => Promise<boolean>) | undefined
let credentialsForTests: Awaited<ReturnType<typeof readMdbServerCredentials>> | undefined

export function setMdbServerConfirmationForTests(handler: typeof confirmationForTests): void {
  confirmationForTests = handler
}

export function setMdbServerCredentialsForTests(value: Awaited<ReturnType<typeof readMdbServerCredentials>> | undefined): void {
  credentialsForTests = value
}

async function loadStoredCredentials() {
  return credentialsForTests === undefined ? readMdbServerCredentials() : credentialsForTests
}

export function credentialOperationKind(existing: boolean): Exclude<ConfirmationKind, 'update'> {
  return existing ? 'replace' : 'save'
}

export function credentialClearOperationKind(): ConfirmationKind {
  return 'clear'
}

const confirmationText: Record<string, Record<ConfirmationKind, { message: string; confirmLabel: string; cancelLabel: string }>> = {
  en: { update: { message: 'Update the MDB server now? Database migrations cannot be undone by restoring files.', confirmLabel: 'Update', cancelLabel: 'Cancel' }, save: { message: 'Save deployment credentials securely for MDB updates?', confirmLabel: 'Save', cancelLabel: 'Cancel' }, replace: { message: 'Replace the saved deployment credentials?', confirmLabel: 'Replace', cancelLabel: 'Cancel' }, clear: { message: 'Delete the saved deployment credentials?', confirmLabel: 'Delete', cancelLabel: 'Cancel' } },
  de: { update: { message: 'MDB-Server jetzt aktualisieren? Datenbankmigrationen können nicht durch Dateiwiederherstellung rückgängig gemacht werden.', confirmLabel: 'Aktualisieren', cancelLabel: 'Abbrechen' }, save: { message: 'Bereitstellungszugangsdaten sicher für MDB-Updates speichern?', confirmLabel: 'Speichern', cancelLabel: 'Abbrechen' }, replace: { message: 'Gespeicherte Bereitstellungszugangsdaten ersetzen?', confirmLabel: 'Ersetzen', cancelLabel: 'Abbrechen' }, clear: { message: 'Gespeicherte Bereitstellungszugangsdaten löschen?', confirmLabel: 'Löschen', cancelLabel: 'Abbrechen' } },
  fr: { update: { message: 'Mettre à jour le serveur MDB maintenant ? Les migrations ne peuvent pas être annulées par restauration des fichiers.', confirmLabel: 'Mettre à jour', cancelLabel: 'Annuler' }, save: { message: 'Enregistrer les identifiants de déploiement pour les mises à jour MDB ?', confirmLabel: 'Enregistrer', cancelLabel: 'Annuler' }, replace: { message: 'Remplacer les identifiants de déploiement enregistrés ?', confirmLabel: 'Remplacer', cancelLabel: 'Annuler' }, clear: { message: 'Supprimer les identifiants de déploiement enregistrés ?', confirmLabel: 'Supprimer', cancelLabel: 'Annuler' } },
  es: { update: { message: '¿Actualizar ahora el servidor MDB? Las migraciones no se pueden deshacer restaurando archivos.', confirmLabel: 'Actualizar', cancelLabel: 'Cancelar' }, save: { message: '¿Guardar de forma segura las credenciales para futuras actualizaciones MDB?', confirmLabel: 'Guardar', cancelLabel: 'Cancelar' }, replace: { message: '¿Reemplazar las credenciales de despliegue guardadas?', confirmLabel: 'Reemplazar', cancelLabel: 'Cancelar' }, clear: { message: '¿Eliminar las credenciales de despliegue guardadas?', confirmLabel: 'Eliminar', cancelLabel: 'Cancelar' } },
  pt: { update: { message: 'Atualizar o servidor MDB agora? As migrações não podem ser desfeitas restaurando arquivos.', confirmLabel: 'Atualizar', cancelLabel: 'Cancelar' }, save: { message: 'Salvar com segurança as credenciais para futuras atualizações MDB?', confirmLabel: 'Salvar', cancelLabel: 'Cancelar' }, replace: { message: 'Substituir as credenciais de implantação salvas?', confirmLabel: 'Substituir', cancelLabel: 'Cancelar' }, clear: { message: 'Excluir as credenciais de implantação salvas?', confirmLabel: 'Excluir', cancelLabel: 'Cancelar' } },
  'zh-CN': { update: { message: '现在更新 MDB 服务器？数据库迁移无法通过恢复文件撤销。', confirmLabel: '更新', cancelLabel: '取消' }, save: { message: '安全保存凭据以便将来更新 MDB？', confirmLabel: '保存', cancelLabel: '取消' }, replace: { message: '替换已保存的部署凭据？', confirmLabel: '替换', cancelLabel: '取消' }, clear: { message: '删除已保存的部署凭据？', confirmLabel: '删除', cancelLabel: '取消' } },
  'zh-TW': { update: { message: '現在更新 MDB 伺服器？資料庫遷移無法透過還原檔案撤銷。', confirmLabel: '更新', cancelLabel: '取消' }, save: { message: '安全儲存憑據以供未來更新 MDB？', confirmLabel: '儲存', cancelLabel: '取消' }, replace: { message: '替換已儲存的部署憑據？', confirmLabel: '替換', cancelLabel: '取消' }, clear: { message: '刪除已儲存的部署憑據？', confirmLabel: '刪除', cancelLabel: '取消' } },
}

async function requireNativeConfirmation(kind: ConfirmationKind, locale?: string): Promise<boolean> {
  const text = confirmationText[locale ?? 'en']?.[kind] ?? confirmationText.en[kind]
  if (confirmationForTests) return confirmationForTests(kind, text)
  const result = await dialog.showMessageBox({
    type: 'warning',
    buttons: [text.cancelLabel, text.confirmLabel],
    defaultId: 0,
    cancelId: 0,
    message: text.message,
  })
  return result.response === 1
}

function deploymentIdentity(inspection: MdbServerUpdateInspection): string {
  const deployed = inspection.deployed
  return deployed ? JSON.stringify([deployed.bundleVersion, deployed.bundleReleaseVersion, deployed.bundleDigest, deployed.bundleFileCount]) : 'none'
}

export function credentialBindingMatches(stored: MdbServerCredentialBinding | null, requested: MdbServerCredentialBinding): boolean {
  return stored !== null && stored.serverUrl === normalizeMdbServerUrl(requested.serverUrl) && stored.organizationId === requested.organizationId
}

export interface MdbServerUpdateResult {
  success: boolean
  status: MdbServerUpdateStatus
  inspection?: MdbServerUpdateInspection
  errorCode?: 'NOT_AUTHORIZED' | 'CREDENTIALS_UNAVAILABLE' | 'CONFIRMATION_REQUIRED' | 'CANCELLED' | 'SERVER_CHANGED' | 'MAINTENANCE_TOKEN_REJECTED' | 'DEPLOYMENT_FAILED' | 'HEALTH_MISMATCH' | 'SERVER_NEWER' | 'VERSION_CONFLICT' | 'ROLLBACK_FAILED' | 'CREDENTIAL_BINDING_MISMATCH' | 'INVALID_PROFILE' | 'UNAVAILABLE'
}

interface HealthResponse {
  ok?: unknown
  supabase?: unknown
  apiVersion?: unknown
  bundleVersion?: unknown
  bundleReleaseVersion?: unknown
  bundleDigest?: unknown
  bundleFileCount?: unknown
}

function safeServerUrl(raw: string): URL {
  return new URL(normalizeMdbServerUrl(raw))
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  const origin = event.senderFrame?.url ?? ''
  if (!origin.startsWith('file://') && !/^https?:\/\/localhost(?::\d+)?(?:\/|$)/u.test(origin)) {
    throw new Error('UNAVAILABLE')
  }
}

function normalizeHealth(body: HealthResponse): MdbServerHealth {
  return {
    ok: body.ok === true,
    supabase: body.supabase === true,
    apiVersion: Number.isInteger(body.apiVersion) ? Number(body.apiVersion) : null,
    bundleVersion: Number.isInteger(body.bundleVersion) ? Number(body.bundleVersion) : null,
    bundleReleaseVersion: typeof body.bundleReleaseVersion === 'string' ? body.bundleReleaseVersion : null,
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

function compareReleaseVersions(left: string, right: string): number | null {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value)
    if (!match) return null
    return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4]?.split('.') ?? [] }
  }
  const a = parse(left); const b = parse(right)
  if (!a || !b) return null
  for (let index = 0; index < 3; index += 1) if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1
  if (a.pre.length === 0 && b.pre.length === 0) return 0
  if (a.pre.length === 0) return 1
  if (b.pre.length === 0) return -1
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    if (index >= a.pre.length) return -1
    if (index >= b.pre.length) return 1
    const leftPart = a.pre[index]; const rightPart = b.pre[index]
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/u.test(leftPart); const rightNumber = /^\d+$/u.test(rightPart)
    if (leftNumber && rightNumber) return Number(leftPart) > Number(rightPart) ? 1 : -1
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1
    return leftPart > rightPart ? 1 : -1
  }
  return 0
}

export function classifyMdbServerUpdate(packaged: MdbBundleManifest, deployed: Pick<MdbServerHealth, 'bundleVersion' | 'bundleReleaseVersion' | 'bundleDigest' | 'bundleFileCount'> | null): MdbServerUpdateInspection['status'] {
  if (!deployed?.bundleDigest || deployed.bundleVersion !== 1 || !deployed.bundleReleaseVersion) return 'unknown'
  if (deployed.bundleDigest === packaged.digest) return 'current'
  const comparison = compareReleaseVersions(packaged.releaseVersion, deployed.bundleReleaseVersion)
  if (comparison === null) return 'unknown'
  return comparison > 0 ? 'update-available' : comparison < 0 ? 'server-newer' : 'same-version-different'
}

export function isMdbServerUpdateRequired(status: MdbServerUpdateInspection['status']): boolean {
  return status === 'update-available' || status === 'same-version-different'
}

export async function inspectMdbServerUpdate(serverUrl: string): Promise<MdbServerUpdateInspection> {
  const packaged = await createMdbBundleManifest(serverBundleRoot(), app.getVersion())
  try {
    const health = await fetchHealth(serverUrl)
    const deployed = {
      bundleVersion: health.bundleVersion,
      bundleReleaseVersion: health.bundleReleaseVersion,
      bundleDigest: health.bundleDigest,
      bundleFileCount: health.bundleFileCount,
    }
    return { status: classifyMdbServerUpdate(packaged, deployed), packaged, deployed }
  } catch {
    return { status: 'unknown', packaged, deployed: null }
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
    const manifest = await createMdbBundleManifest(bundleRoot, app.getVersion())
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
  let preserveEvidence = false
  let rollbackAttempted = false
  try {
    await ops.migrate()
    activation = await ops.activate()
    if (!(await ops.verifyHealth())) {
      rollbackAttempted = true
      try { await ops.rollback(activation) } catch { preserveEvidence = true; return { success: false, status: 'failure', errorCode: 'ROLLBACK_FAILED' } }
      return { success: false, status: 'rollback', errorCode: 'HEALTH_MISMATCH' }
    }
    await ops.finalize(activation)
    return { success: true, status: 'current' }
  } catch (error) {
    if (error instanceof RemoteRollbackError) preserveEvidence = true
    if (activation && !rollbackAttempted) {
      rollbackAttempted = true
      try { await ops.rollback(activation) } catch { preserveEvidence = true; return { success: false, status: 'failure', errorCode: 'ROLLBACK_FAILED' } }
    }
    const message = error instanceof Error ? error.message : ''
    return {
      success: false,
      status: activation ? 'rollback' : 'failure',
      errorCode: error instanceof RemoteRollbackError ? 'ROLLBACK_FAILED' : /maintenance|migration token/i.test(message) ? 'MAINTENANCE_TOKEN_REJECTED' : 'DEPLOYMENT_FAILED',
    }
  } finally {
    if (!preserveEvidence) await ops.cleanup().catch(() => undefined)
  }
}

export async function applyMdbServerUpdate(request: MdbServerUpdateRequest): Promise<MdbServerUpdateResult> {
  try {
    await assertOwnerOrAdmin(request.serverUrl, request.sessionToken, request.organizationId)
  } catch {
    return { success: false, status: 'failure', errorCode: 'NOT_AUTHORIZED' }
  }
  let inspection: MdbServerUpdateInspection
  try { inspection = await inspectMdbServerUpdate(request.serverUrl) } catch { return { success: false, status: 'failure', errorCode: 'UNAVAILABLE' } }
  if (inspection.status === 'server-newer') return { success: false, status: 'server-newer', errorCode: 'SERVER_NEWER' }
  if (inspection.status === 'current') return { success: true, status: 'current', inspection }
  const stored = await loadStoredCredentials()
  if (!stored) return { success: false, status: 'failure', errorCode: 'CREDENTIALS_UNAVAILABLE' }
  if (!credentialBindingMatches(stored.binding, { serverUrl: request.serverUrl, organizationId: request.organizationId })) return { success: false, status: 'failure', errorCode: 'CREDENTIAL_BINDING_MISMATCH' }
  if (!await requireNativeConfirmation('update', request.locale)) return { success: false, status: 'failure', errorCode: 'CANCELLED' }
  let confirmedInspection: MdbServerUpdateInspection
  try { confirmedInspection = await inspectMdbServerUpdate(request.serverUrl) } catch { return { success: false, status: 'failure', errorCode: 'UNAVAILABLE' } }
  if (deploymentIdentity(confirmedInspection) !== deploymentIdentity(inspection)) return { success: false, status: 'failure', errorCode: 'SERVER_CHANGED' }
  if (confirmedInspection.status === 'server-newer') return { success: false, status: 'server-newer', errorCode: 'SERVER_NEWER' }
  if (confirmedInspection.status === 'current') return { success: true, status: 'current', inspection: confirmedInspection }
  let cleanup: (() => Promise<void>) | undefined
  let activation: RemoteDeploymentActivation | undefined
  let client: Client | undefined
  let preserveEvidence = false
  try {
    const ftp = ftpBase(stored.profile.ftpUrl, stored.profile.ftpSecurity)
    const publicUrl = safeServerUrl(request.serverUrl)
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
        const migrate = await installerRequest<{ applied?: string[] }>(publicUrl, stage.bridgeName, '/admin/migrate', { maintenanceToken: stored.secrets.maintenanceToken })
        if (!Array.isArray(migrate.applied)) throw new Error('MAINTENANCE_TOKEN_REJECTED')
      },
      activate: async () => {
        activation = await activateRemoteDeployment(client!, targetRoot, stageRoot, false, true)
        return activation
      },
      verifyHealth: async () => {
        const health = await fetchHealth(request.serverUrl)
        return health.bundleDigest === stage.manifest.digest && health.bundleVersion === stage.manifest.version && health.bundleReleaseVersion === stage.manifest.releaseVersion
      },
      finalize: (current) => finalizeRemoteDeployment(client!, current),
      rollback: (current) => rollbackRemoteDeployment(client!, current),
      cleanup: stage.cleanup,
    })
    cleanup = undefined
    return plan
  } catch (error) {
    if (error instanceof RemoteRollbackError) { preserveEvidence = true; return { success: false, status: 'failure', errorCode: 'ROLLBACK_FAILED' } }
    if (activation && client) {
      try { await rollbackRemoteDeployment(client, activation) } catch { preserveEvidence = true; return { success: false, status: 'failure', errorCode: 'ROLLBACK_FAILED' } }
    }
    const code = error instanceof Error ? error.message : ''
    return { success: false, status: activation ? 'rollback' : 'failure', errorCode: code === 'MAINTENANCE_TOKEN_REJECTED' ? 'MAINTENANCE_TOKEN_REJECTED' : 'DEPLOYMENT_FAILED' }
  } finally {
    client?.close()
    if (!preserveEvidence) await cleanup?.()
  }
}

export function registerMdbServerUpdateHandlers(): void {
  ipcMain.handle('mdb-server:inspect-update', async (event, serverUrl: string) => { assertTrustedSender(event); return inspectMdbServerUpdate(serverUrl) })
  ipcMain.handle('mdb-server:apply-update', async (event, request: MdbServerUpdateRequest) => { assertTrustedSender(event); return applyMdbServerUpdate(request) })
  ipcMain.handle('mdb-server:get-credentials', async (event, binding: MdbServerCredentialRequest) => { assertTrustedSender(event); await assertOwnerOrAdmin(binding.serverUrl, binding.sessionToken, binding.organizationId); const state = await getMdbServerCredentialState(); const stored = await readMdbServerCredentials(); return { hasCredentials: Boolean(state.hasCredentials && credentialBindingMatches(stored?.binding ?? null, binding)), encryptionAvailable: state.encryptionAvailable } })
  ipcMain.handle('mdb-server:save-credentials', async (event, profile: MdbServerProfile, secrets: { ftpPassword: string; maintenanceToken: string }, binding: MdbServerCredentialRequest) => {
    assertTrustedSender(event)
    await assertOwnerOrAdmin(binding.serverUrl, binding.sessionToken, binding.organizationId)
    const existing = await readMdbServerCredentials()
    const kind: ConfirmationKind = credentialOperationKind(Boolean(existing))
    if (!await requireNativeConfirmation(kind, binding.locale)) throw new Error('CANCELLED')
    await saveMdbServerCredentials(profile, secrets, binding)
    const state = await getMdbServerCredentialState(); return { hasCredentials: state.hasCredentials, encryptionAvailable: state.encryptionAvailable }
  })
  ipcMain.handle('mdb-server:clear-credentials', async (event, binding: MdbServerCredentialRequest) => {
    assertTrustedSender(event)
    await assertOwnerOrAdmin(binding.serverUrl, binding.sessionToken, binding.organizationId)
    if (!await requireNativeConfirmation(credentialClearOperationKind(), binding.locale)) throw new Error('CANCELLED')
    await clearMdbServerCredentials(binding)
    const state = await getMdbServerCredentialState(); return { hasCredentials: state.hasCredentials, encryptionAvailable: state.encryptionAvailable }
  })
}

export function unregisterMdbServerUpdateHandlers(): void {
  ipcMain.removeHandler('mdb-server:inspect-update')
  ipcMain.removeHandler('mdb-server:apply-update')
  ipcMain.removeHandler('mdb-server:get-credentials')
  ipcMain.removeHandler('mdb-server:save-credentials')
  ipcMain.removeHandler('mdb-server:clear-credentials')
}
