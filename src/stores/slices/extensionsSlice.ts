/**
 * Extensions Slice - State for per-machine extension packages
 *
 * This slice manages:
 * - Installed extension packages, as the main process lists them
 * - Store (marketplace) listings
 *
 * The desktop has no extension runtime: packages are installed and listed, never
 * run. Install, sideload and uninstall are administrator actions.
 */
import { StateCreator } from 'zustand'
import type {
  PDMStoreState,
  ExtensionsSlice,
  InstalledExtension,
  StoreExtensionListing,
  ExtensionLifecycleState,
} from '../types'
import { log } from '@/lib/logger'
import { validateWorkspaceRegistration } from '@/lib/nativeExtensions/registry'

// Initial state
const initialState: Pick<
  ExtensionsSlice,
  'installedExtensions' | 'storeExtensions' | 'storeLoading' | 'storeVerifiedOnly' | 'storeSort'
> = {
  installedExtensions: {},
  storeExtensions: [],
  storeLoading: false,
  storeVerifiedOnly: false,
  storeSort: 'popular',
}

/**
 * The renderer-side admin gate for extension installs. Main never sees the role.
 * Returns `adminRequired` rather than a sentence: the slice does not import i18n
 * (it would close an import cycle through the store), so the dialog translates it.
 */
function requireAdmin(
  state: PDMStoreState,
): { success: false; adminRequired: true; error?: undefined } | null {
  if (state.getEffectiveRole() === 'admin') return null
  return { success: false, adminRequired: true }
}

export const createExtensionsSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  ExtensionsSlice
> = (set, get) => ({
  // Initial state
  ...initialState,

  // ═══════════════════════════════════════════════════════════════════════════
  // Native extensions
  // ═══════════════════════════════════════════════════════════════════════════

  nativeExtensions: {},
  extensionWorkspaces: [],
  extensionRightPanel: null,
  orgNativeExtensionRows: [],

  setOrgNativeExtensionRows: (rows) => {
    set({ orgNativeExtensionRows: rows })
  },

  setNativeExtensionState: (state) => {
    set((current) => ({
      nativeExtensions: { ...current.nativeExtensions, [state.extensionId]: state },
    }))
  },

  removeNativeExtensionState: (extensionId) => {
    set((current) => {
      if (!(extensionId in current.nativeExtensions)) return current
      const { [extensionId]: _removed, ...rest } = current.nativeExtensions
      return { nativeExtensions: rest }
    })
  },

  registerExtensionWorkspace: (extensionId, registration) => {
    const workspace = validateWorkspaceRegistration(
      extensionId,
      registration,
      get().extensionWorkspaces,
    )
    set((current) => ({ extensionWorkspaces: [...current.extensionWorkspaces, workspace] }))
    return workspace
  },

  unregisterExtensionWorkspace: (extensionId, workspaceId) => {
    set((current) => {
      const removed = current.extensionWorkspaces.filter(
        (w) => w.extensionId === extensionId && (workspaceId === undefined || w.id === workspaceId),
      )
      if (removed.length === 0) return current
      const removedIds = new Set(removed.map((w) => w.id))
      const patch: Partial<PDMStoreState> = {
        extensionWorkspaces: current.extensionWorkspaces.filter((w) => !removed.includes(w)),
      }
      if (current.extensionRightPanel && removedIds.has(current.extensionRightPanel)) {
        patch.extensionRightPanel = null
      }
      // A view that no longer exists falls back to the explorer.
      if (removedIds.has(current.activeView as string)) {
        patch.activeView = 'explorer'
      }
      return patch
    })
  },

  setExtensionRightPanel: (workspaceId) => {
    if (get().extensionRightPanel === workspaceId) return
    set({ extensionRightPanel: workspaceId })
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Synchronous Actions
  // ═══════════════════════════════════════════════════════════════════════════

  setInstalledExtensions: (extensions: Record<string, InstalledExtension>) => {
    set({ installedExtensions: extensions })
  },

  removeInstalledExtension: (extensionId: string) => {
    set((state) => {
      if (!(extensionId in state.installedExtensions)) return state
      const { [extensionId]: _removed, ...remaining } = state.installedExtensions
      return { installedExtensions: remaining }
    })
  },

  setStoreExtensions: (extensions: StoreExtensionListing[]) => {
    set({ storeExtensions: extensions })
  },

  setStoreLoading: (loading: boolean) => {
    set({ storeLoading: loading })
  },

  handleExtensionStateChange: (extensionId: string, state: ExtensionLifecycleState) => {
    if (state === 'not-installed') {
      get().removeInstalledExtension(extensionId)
    } else {
      void get().loadInstalledExtensions()
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Async Actions
  // ═══════════════════════════════════════════════════════════════════════════

  loadInstalledExtensions: async () => {
    try {
      const api = window.electronAPI?.extensions
      if (!api) {
        log.warn('[Extensions]', 'Extensions API not available')
        return
      }

      const extensions = await api.getAll()
      const extensionsMap: Record<string, InstalledExtension> = {}

      for (const ext of extensions) {
        extensionsMap[ext.manifest.id] = ext
      }

      get().setInstalledExtensions(extensionsMap)
      log.info('[Extensions]', 'Loaded installed extensions', { count: extensions.length })
    } catch (error) {
      log.error('[Extensions]', 'Failed to load installed extensions', { error: error })
    }
  },

  fetchStoreExtensions: async () => {
    const { setStoreLoading, setStoreExtensions } = get()

    try {
      setStoreLoading(true)

      const api = window.electronAPI?.extensions
      if (!api) {
        log.warn('[Extensions]', 'Extensions API not available')
        return
      }

      const extensions = await api.fetchStore()
      setStoreExtensions(extensions)
      log.info('[Extensions]', 'Fetched store extensions', { count: extensions.length })
    } catch (error) {
      log.error('[Extensions]', 'Failed to fetch store extensions', { error: error })
    } finally {
      setStoreLoading(false)
    }
  },

  searchStoreExtensions: async (query?: string, category?: string) => {
    const { setStoreLoading, setStoreExtensions, storeVerifiedOnly, storeSort } = get()

    try {
      setStoreLoading(true)

      const api = window.electronAPI?.extensions
      if (!api) {
        log.warn('[Extensions]', 'Extensions API not available')
        return
      }

      const result = await api.searchStore({
        query,
        category,
        verifiedOnly: storeVerifiedOnly,
        sort: storeSort,
        page: 1,
        pageSize: 50,
      })

      setStoreExtensions(result.extensions)
      log.info('[Extensions]', 'Searched store extensions', {
        query,
        category,
        count: result.extensions.length,
        total: result.total,
      })
    } catch (error) {
      log.error('[Extensions]', 'Failed to search store extensions', { error: error })
    } finally {
      setStoreLoading(false)
    }
  },

  installExtension: async (extensionId: string, version?: string) => {
    const refused = requireAdmin(get())
    if (refused) return refused

    try {
      const api = window.electronAPI?.extensions
      if (!api) {
        return { success: false, error: 'Extensions API not available' }
      }

      // Find the store extension to get the database UUID for download
      const storeExt = get().storeExtensions.find((e) => e.extensionId === extensionId)
      const downloadId = storeExt?.id || extensionId // Use database UUID if available

      log.info('[Extensions]', 'Installing extension', { extensionId, downloadId, version })
      const result = await api.install(downloadId, version, extensionId)

      if (result.success) {
        await get().loadInstalledExtensions()
        log.info('[Extensions]', 'Extension installed', {
          extensionId: result.extensionId,
          version: result.version,
        })
      }

      return { success: result.success, error: result.error }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[Extensions]', 'Failed to install extension', { extensionId, error: message })
      return { success: false, error: message }
    }
  },

  sideloadExtension: async (bpxPath: string, acknowledgeUnsigned = false) => {
    const refused = requireAdmin(get())
    if (refused) return refused

    try {
      const api = window.electronAPI?.extensions
      if (!api) {
        return { success: false, error: 'Extensions API not available' }
      }

      log.info('[Extensions]', 'Sideloading extension', { bpxPath })
      const result = await api.installFromFile(bpxPath, acknowledgeUnsigned)

      if (result.success) {
        await get().loadInstalledExtensions()
        log.info('[Extensions]', 'Extension sideloaded', {
          extensionId: result.extensionId,
          version: result.version,
        })
      }

      return { success: result.success, error: result.error }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[Extensions]', 'Failed to sideload extension', { bpxPath, error: message })
      return { success: false, error: message }
    }
  },

  uninstallExtension: async (extensionId: string) => {
    const refused = requireAdmin(get())
    if (refused) return refused

    try {
      const api = window.electronAPI?.extensions
      if (!api) {
        return { success: false, error: 'Extensions API not available' }
      }

      log.info('[Extensions]', 'Uninstalling extension', { extensionId })
      const result = await api.uninstall(extensionId)

      if (result.success) {
        get().removeInstalledExtension(extensionId)
      }

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[Extensions]', 'Failed to uninstall extension', { extensionId, error: message })
      return { success: false, error: message }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Getters
  // ═══════════════════════════════════════════════════════════════════════════

  getExtension: (extensionId: string) => {
    return get().installedExtensions[extensionId]
  },

  isExtensionInstalled: (extensionId: string) => {
    return extensionId in get().installedExtensions
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Reset
  // ═══════════════════════════════════════════════════════════════════════════

  clearExtensionsState: () => {
    set(initialState)
  },
})
