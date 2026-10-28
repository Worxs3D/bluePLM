/**
 * The app's one native extension loader, wired to the store, main and Supabase.
 */

import { usePDMStore } from '@/stores/pdmStore'
import { log } from '@/lib/logger'
import type { OrgNativeExtensionRow } from '@/types/nativeExtensions'
import { createNativeExtensionHost } from './host'
import { NativeExtensionLoader, type PreparedPackage } from './loader'
import { createPackageDownloadUrl, fetchOrgNativeExtensions } from './orgExtensions'
import { installBluePLMGlobal } from './shared'

async function prepare(row: OrgNativeExtensionRow): Promise<PreparedPackage> {
  const api = window.electronAPI?.extensions
  if (!api?.nativePrepare) throw new Error('Native extensions need the desktop app')
  const downloadUrl = await createPackageDownloadUrl(row.packagePath)
  const result = await api.nativePrepare({
    extensionId: row.extensionId,
    version: row.version,
    sha256: row.sha256,
    downloadUrl,
  })
  if (!result.success) throw new Error(result.error)
  return { clientEntryUrl: result.clientEntryUrl, manifest: result.manifest }
}

export const nativeExtensionLoader = new NativeExtensionLoader({
  prepare,
  importModule: (url) => import(/* @vite-ignore */ url),
  createHost: createNativeExtensionHost,
  setState: (state) => usePDMStore.getState().setNativeExtensionState(state),
  removeState: (id) => usePDMStore.getState().removeNativeExtensionState(id),
  clearRegistrations: (id) => usePDMStore.getState().unregisterExtensionWorkspace(id),
  prune: async (keep) => {
    await window.electronAPI?.extensions?.nativePrune?.(keep)
  },
})

let globalInstalled = false

/**
 * Load the organization's native rows and bring the running extensions in line.
 * Returns the rows (enabled or not) for the settings page.
 */
export async function reloadNativeExtensions(orgId: string): Promise<OrgNativeExtensionRow[]> {
  if (!globalInstalled) {
    const version = (await window.electronAPI?.getVersion?.()) ?? '0.0.0'
    installBluePLMGlobal(version)
    globalInstalled = true
  }
  const { rows, invalid } = await fetchOrgNativeExtensions(orgId)
  for (const reason of invalid) log.warn('[NativeExt]', 'Ignoring native extension row', { reason })
  usePDMStore.getState().setOrgNativeExtensionRows(rows)
  await nativeExtensionLoader.sync(rows)
  return rows
}

export function deactivateAllNativeExtensions(): Promise<void> {
  usePDMStore.getState().setOrgNativeExtensionRows([])
  return nativeExtensionLoader.deactivateAll()
}
