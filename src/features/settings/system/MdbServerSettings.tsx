import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Server, ShieldCheck, Upload, Trash2 } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'
import { isMdbBackendActive } from '@/lib/backendAdapter'
import { loadMdbConfig, mdbAccessToken } from '@/lib/mdb'
import { usePDMStore } from '@/stores/pdmStore'

type MdbServerStatus = 'current' | 'update-available' | 'unknown' | 'updating' | 'rollback' | 'failure'
type Profile = { ftpUrl: string; ftpSecurity: 'explicit' | 'implicit'; ftpRemotePath: string; ftpUsername: string }
type Inspection = {
  status: 'current' | 'update-available' | 'unknown'
  packaged: { version: number; digest: string; fileCount: number }
  deployed: { bundleVersion: number | null; bundleDigest: string | null; bundleFileCount: number | null } | null
  credentials: { profile: Profile | null; hasCredentials: boolean; encryptionAvailable: boolean }
}

const statusTranslation: Record<MdbServerStatus, string> = {
  current: 'settingsPages.mdbServer.statusCurrent',
  'update-available': 'settingsPages.mdbServer.statusUpdateAvailable',
  unknown: 'settingsPages.mdbServer.statusUnknown',
  updating: 'settingsPages.mdbServer.statusUpdating',
  rollback: 'settingsPages.mdbServer.statusRollback',
  failure: 'settingsPages.mdbServer.statusFailure',
}

export function MdbServerSettings() {
  const { t } = useTranslation()
  const organization = usePDMStore((state) => state.organization)
  const getEffectiveRole = usePDMStore((state) => state.getEffectiveRole)
  const addToast = usePDMStore((state) => state.addToast)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [status, setStatus] = useState<MdbServerStatus>('unknown')
  const [profile, setProfile] = useState<Profile>({ ftpUrl: '', ftpSecurity: 'explicit', ftpRemotePath: '', ftpUsername: '' })
  const [ftpPassword, setFtpPassword] = useState('')
  const [maintenanceToken, setMaintenanceToken] = useState('')
  const [busy, setBusy] = useState(false)
  const serverUrl = loadMdbConfig()?.serverUrl ?? ''
  const canManage = ['owner', 'admin'].includes(getEffectiveRole())

  const recheck = useCallback(async () => {
    if (!serverUrl || !window.electronAPI?.inspectMdbServerUpdate) return
    const result = await window.electronAPI.inspectMdbServerUpdate(serverUrl)
    setInspection(result)
    setStatus(result.status)
  }, [serverUrl])

  useEffect(() => {
    if (!isMdbBackendActive() || !canManage || !window.electronAPI?.getMdbServerCredentialState) return
    let cancelled = false
    void Promise.all([
      window.electronAPI.getMdbServerCredentialState(),
      window.electronAPI.inspectMdbServerUpdate(serverUrl),
    ]).then(([credentials, nextInspection]) => {
      if (cancelled) return
      if (credentials.profile) setProfile(credentials.profile)
      setInspection(nextInspection)
      setStatus(nextInspection.status)
    }).catch(() => {
      if (!cancelled) setStatus('unknown')
    })
    return () => { cancelled = true }
  }, [canManage, serverUrl])

  const saveCredentials = async () => {
    if (!window.electronAPI?.saveMdbServerCredentials) return
    setBusy(true)
    try {
      const next = await window.electronAPI.saveMdbServerCredentials(profile, {
        ftpPassword,
        maintenanceToken,
      })
      setInspection((current) => current ? { ...current, credentials: next } : current)
      setFtpPassword('')
      setMaintenanceToken('')
      addToast('success', t('settingsPages.saveSettings'))
    } catch {
      addToast('error', t('settingsPages.mdbServer.encryptionUnavailable'))
    } finally {
      setBusy(false)
    }
  }

  const clearCredentials = async () => {
    if (!window.electronAPI?.clearMdbServerCredentials) return
    setBusy(true)
    try {
      const next = await window.electronAPI.clearMdbServerCredentials()
      setInspection((current) => current ? { ...current, credentials: next } : current)
    } finally {
      setBusy(false)
    }
  }

  const applyUpdate = async () => {
    if (!window.electronAPI?.applyMdbServerUpdate || !organization?.id) return
    if (!window.confirm(t('settingsPages.mdbServer.confirmUpdate'))) return
    setBusy(true)
    setStatus('updating')
    try {
      const result = await window.electronAPI.applyMdbServerUpdate({
        serverUrl,
        sessionToken: mdbAccessToken() ?? '',
        organizationId: organization.id,
        confirmed: true,
      })
      setStatus(result.status)
      if (result.success) addToast('success', t('settingsPages.mdbServer.resultSuccess'))
      else if (result.errorCode === 'NOT_AUTHORIZED') addToast('error', t('settingsPages.mdbServer.unauthorized'))
      else if (result.errorCode === 'MAINTENANCE_TOKEN_REJECTED') addToast('error', t('settingsPages.mdbServer.invalidMaintenanceToken'))
      else if (result.errorCode === 'CREDENTIALS_UNAVAILABLE') addToast('error', t('settingsPages.mdbServer.missingCredentials'))
      else if (result.errorCode === 'HEALTH_MISMATCH') addToast('error', t('settingsPages.mdbServer.healthMismatch'))
      else addToast('error', t('settingsPages.mdbServer.genericFailure'))
      await recheck()
    } catch {
      setStatus('failure')
      addToast('error', t('settingsPages.mdbServer.genericFailure'))
    } finally {
      setBusy(false)
    }
  }

  const statusLabel = t(statusTranslation[status])
  const credentials = inspection?.credentials
  const updateDisabled = busy || !credentials?.hasCredentials || status === 'current' || status === 'unknown'
  const digest = useMemo(() => (value: string | null | undefined) => value ? `${value.slice(0, 12)}…` : '—', [])

  if (!isMdbBackendActive() || !canManage) return null

  return (
    <div className="space-y-6" data-testid="mdb-server-settings">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-plm-fg"><Server size={18} />{t('settingsPages.mdbServer.title')}</h2>
          <p className="mt-1 text-sm text-plm-fg-muted">{t('settingsPages.mdbServer.description')}</p>
        </div>
        <button type="button" onClick={() => void recheck()} disabled={busy} className="flex items-center gap-2 rounded border border-plm-border px-3 py-2 text-sm text-plm-fg-muted hover:text-plm-fg">
          <RefreshCw size={14} />{t('settingsPages.mdbServer.recheck')}
        </button>
      </div>

      <section className="rounded border border-plm-border bg-plm-bg-lighter p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-plm-fg"><ShieldCheck size={16} />{t('settingsPages.mdbServer.statusLabel')}: <strong>{statusLabel}</strong></div>
        <div className="grid gap-2 text-xs text-plm-fg-muted sm:grid-cols-2">
          <span>{t('settingsPages.mdbServer.packagedDigest')}: {digest(inspection?.packaged.digest)}</span>
          <span>{t('settingsPages.mdbServer.deployedDigest')}: {digest(inspection?.deployed?.bundleDigest)}</span>
          <span>{t('settingsPages.mdbServer.version')}: {inspection?.deployed?.bundleVersion ?? '—'} / {inspection?.packaged.version ?? '—'}</span>
          <span>{t('settingsPages.mdbServer.fileCount')}: {inspection?.deployed?.bundleFileCount ?? '—'} / {inspection?.packaged.fileCount ?? '—'}</span>
        </div>
        <p className="text-xs text-plm-fg-muted">{t('settingsPages.mdbServer.maintenanceNote')}</p>
        <button type="button" onClick={() => void applyUpdate()} disabled={updateDisabled} className="flex items-center gap-2 rounded bg-plm-accent px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50">
          <Upload size={14} />{t('settingsPages.mdbServer.update')}
        </button>
      </section>

      <section className="space-y-3 border-t border-plm-border pt-4">
        <h3 className="text-sm font-medium text-plm-fg">{t('settingsPages.mdbServer.credentialsTitle')}</h3>
        <p className="text-xs text-plm-fg-muted">{t('settingsPages.mdbServer.credentialsDescription')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-plm-fg-muted">{t('settingsPages.mdbServer.ftpUrl')}<input value={profile.ftpUrl} onChange={(event) => setProfile({ ...profile, ftpUrl: event.target.value })} className="mt-1 w-full rounded border border-plm-border bg-plm-bg px-2 py-1.5 text-sm text-plm-fg" /></label>
          <label className="text-xs text-plm-fg-muted">{t('settingsPages.mdbServer.ftpSecurity')}<select value={profile.ftpSecurity} onChange={(event) => setProfile({ ...profile, ftpSecurity: event.target.value as Profile['ftpSecurity'] })} className="mt-1 w-full rounded border border-plm-border bg-plm-bg px-2 py-1.5 text-sm text-plm-fg"><option value="explicit">{t('settingsPages.mdbServer.explicitTls')}</option><option value="implicit">{t('settingsPages.mdbServer.implicitTls')}</option></select></label>
          <label className="text-xs text-plm-fg-muted">{t('settingsPages.mdbServer.ftpRemotePath')}<input value={profile.ftpRemotePath} onChange={(event) => setProfile({ ...profile, ftpRemotePath: event.target.value })} className="mt-1 w-full rounded border border-plm-border bg-plm-bg px-2 py-1.5 text-sm text-plm-fg" /></label>
          <label className="text-xs text-plm-fg-muted">{t('settingsPages.mdbServer.ftpUsername')}<input value={profile.ftpUsername} onChange={(event) => setProfile({ ...profile, ftpUsername: event.target.value })} className="mt-1 w-full rounded border border-plm-border bg-plm-bg px-2 py-1.5 text-sm text-plm-fg" /></label>
          <label className="text-xs text-plm-fg-muted">{t('settingsPages.mdbServer.ftpPassword')}<input type="password" placeholder={t('settingsPages.mdbServer.passwordPlaceholder')} value={ftpPassword} onChange={(event) => setFtpPassword(event.target.value)} className="mt-1 w-full rounded border border-plm-border bg-plm-bg px-2 py-1.5 text-sm text-plm-fg" /></label>
          <label className="text-xs text-plm-fg-muted">{t('settingsPages.mdbServer.maintenanceToken')}<input type="password" placeholder={t('settingsPages.mdbServer.tokenPlaceholder')} value={maintenanceToken} onChange={(event) => setMaintenanceToken(event.target.value)} className="mt-1 w-full rounded border border-plm-border bg-plm-bg px-2 py-1.5 text-sm text-plm-fg" /></label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void saveCredentials()} disabled={busy || !ftpPassword || !maintenanceToken} className="rounded border border-plm-border px-3 py-2 text-sm text-plm-fg disabled:opacity-50">{t('settingsPages.mdbServer.saveCredentials')}</button>
          <button type="button" onClick={() => void clearCredentials()} disabled={busy || !credentials?.hasCredentials} className="flex items-center gap-2 rounded border border-plm-border px-3 py-2 text-sm text-plm-fg-muted disabled:opacity-50"><Trash2 size={14} />{t('settingsPages.mdbServer.clearCredentials')}</button>
          <span className="text-xs text-plm-fg-muted">{credentials?.hasCredentials ? t('settingsPages.mdbServer.credentialsStored') : t('settingsPages.mdbServer.credentialsMissing')}</span>
        </div>
      </section>
    </div>
  )
}
