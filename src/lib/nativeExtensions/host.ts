/**
 * Builds the `host` object a native extension's `activate(host)` receives
 * (contract v1, .cursor/plans/extensions-native-runtime.plan.md).
 */

import { useMemo } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { usePDMStore } from '@/stores/pdmStore'
import { getSupabaseClient } from '@/lib/supabase/client'
import { isAdminUser } from '@/lib/isAdminUser'
import { log } from '@/lib/logger'
import type {
  Disposable,
  HostOrganization,
  HostUser,
  NativeExtensionHost,
  NativeExtensionManifest,
  PermissionAction,
  WorkspaceRegistration,
} from '@/types/nativeExtensions'

export interface HostContext {
  extensionId: string
  version: string
  manifest: NativeExtensionManifest
  /** Called with every Disposable the host hands out, so deactivation can dispose them. */
  track(disposable: Disposable): void
}

const STORAGE_PREFIX = 'blueplm-ext-storage'

function storageKey(extensionId: string): string {
  const userId = usePDMStore.getState().user?.id ?? 'anonymous'
  return `${STORAGE_PREFIX}:${extensionId}:${userId}`
}

function readStorage(extensionId: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(storageKey(extensionId))
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function toLogData(data: unknown): Record<string, unknown> | undefined {
  if (data === undefined) return undefined
  if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>
  return { data }
}

export function createNativeExtensionHost(context: HostContext): NativeExtensionHost {
  const { extensionId } = context
  const category = `[Ext:${extensionId}]`

  const ownWorkspaceIds = (): string[] =>
    usePDMStore
      .getState()
      .extensionWorkspaces.filter((w) => w.extensionId === extensionId)
      .map((w) => w.id)

  return {
    apiVersion: 1,
    extension: { id: extensionId, version: context.version, manifest: context.manifest },
    supabase: getSupabaseClient() as unknown as SupabaseClient,

    async getAccessToken() {
      const { data } = await getSupabaseClient().auth.getSession()
      return data.session?.access_token ?? null
    },

    useOrganization(): HostOrganization | null {
      const organization = usePDMStore((s) => s.organization)
      const apiServerUrl = usePDMStore((s) => s.apiServerUrl)
      const id = organization?.id ?? null
      const name = organization?.name ?? ''
      const apiUrl = apiServerUrl ? apiServerUrl.replace(/\/$/, '') : null
      return useMemo(() => (id ? { id, name, apiUrl } : null), [id, name, apiUrl])
    },

    useCurrentUser(): HostUser | null {
      const user = usePDMStore((s) => s.user)
      const isAdmin = usePDMStore((s) => isAdminUser(s.user?.role, s.userTeams))
      const id = user?.id ?? null
      const email = user?.email ?? ''
      return useMemo(() => (id ? { id, email, isAdmin } : null), [id, email, isAdmin])
    },

    usePermission(resource: string, action: PermissionAction): boolean {
      return usePDMStore((s) => s.hasPermission(resource, action))
    },

    log: {
      debug: (msg, data) => log.debug(category, msg, toLogData(data)),
      info: (msg, data) => log.info(category, msg, toLogData(data)),
      warn: (msg, data) => log.warn(category, msg, toLogData(data)),
      error: (msg, data) => log.error(category, msg, toLogData(data)),
    },

    toast(kind, message) {
      usePDMStore.getState().addToast(kind, String(message))
    },

    storage: {
      get<T>(key: string): T | undefined {
        return readStorage(extensionId)[key] as T | undefined
      },
      set(key: string, value: unknown): void {
        try {
          const next = { ...readStorage(extensionId), [key]: value }
          localStorage.setItem(storageKey(extensionId), JSON.stringify(next))
        } catch (error) {
          log.warn(category, 'host.storage.set failed', { key, error: String(error) })
        }
      },
    },

    registerWorkspace(registration: WorkspaceRegistration): Disposable {
      const workspace = usePDMStore.getState().registerExtensionWorkspace(extensionId, registration)
      let disposed = false
      const disposable: Disposable = {
        dispose() {
          if (disposed) return
          disposed = true
          usePDMStore.getState().unregisterExtensionWorkspace(extensionId, workspace.id)
        },
      }
      context.track(disposable)
      return disposable
    },

    rightPanel: {
      open() {
        const state = usePDMStore.getState()
        const own = state.extensionWorkspaces.filter(
          (w) => w.extensionId === extensionId && w.RightPanel,
        )
        const target = own.find((w) => w.id === state.activeView) ?? own[0]
        if (target) state.setExtensionRightPanel(target.id)
      },
      close() {
        const state = usePDMStore.getState()
        if (state.extensionRightPanel && ownWorkspaceIds().includes(state.extensionRightPanel)) {
          state.setExtensionRightPanel(null)
        }
      },
    },

    useRightPanelOpen(): boolean {
      return usePDMStore(
        (s) =>
          !!s.extensionRightPanel &&
          s.extensionRightPanel === s.activeView &&
          s.extensionWorkspaces.some(
            (w) => w.extensionId === extensionId && w.id === s.extensionRightPanel,
          ),
      )
    },
  }
}
