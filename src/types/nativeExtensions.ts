/**
 * Native extension host contract, v1 (renderer side).
 *
 * The authority is "Host API (contract v1)" in
 * .cursor/plans/extensions-native-runtime.plan.md. An extension's client entry
 * (`client/index.js`, an ES module served from `blueplm-ext://<sha256>/`) exports
 * `activate(host)` and optionally `deactivate()`.
 */

import type { ComponentType } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ModuleGroupId } from './modules'

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'admin'

export interface Disposable {
  dispose(): void
}

export interface NativeExtensionManifest {
  id: string
  name: string
  version: string
  [key: string]: unknown
}

export interface HostLog {
  debug(msg: string, data?: unknown): void
  info(msg: string, data?: unknown): void
  warn(msg: string, data?: unknown): void
  error(msg: string, data?: unknown): void
}

export type HostToastKind = 'success' | 'error' | 'info' | 'warning'

export interface HostOrganization {
  id: string
  name: string
  apiUrl: string | null
}

export interface HostUser {
  id: string
  email: string
  isAdmin: boolean
}

/** What an extension passes to `host.registerWorkspace`. */
export interface WorkspaceRegistration {
  /**
   * The module/view id, used verbatim (so `user_can_access_module(id)` and
   * `module_access` rows work). Must not collide with a core module or another
   * extension's workspace; registration throws if it does.
   */
  id: string
  title: string
  /** lucide-react icon name */
  icon: string
  /** A core module group id; unknown or missing places it before the System modules. */
  group?: string
  /** Team permission resource; the workspace is shown only with its 'view' action. */
  permission?: string
  Navigator?: ComponentType
  Workspace: ComponentType
  /** Shown while the extension has called host.rightPanel.open() and this workspace is active. */
  RightPanel?: ComponentType
}

/** A workspace as the host keeps it, after validation. */
export interface ExtensionWorkspace {
  extensionId: string
  id: string
  title: string
  icon: string
  group: ModuleGroupId | null
  permission: string | null
  Navigator: ComponentType | null
  Workspace: ComponentType
  RightPanel: ComponentType | null
}

export interface NativeExtensionHost {
  apiVersion: 1
  extension: { id: string; version: string; manifest: NativeExtensionManifest }
  /** The app's authenticated Supabase client. */
  supabase: SupabaseClient
  getAccessToken(): Promise<string | null>
  /** React hook. Stable reference while the organization does not change. */
  useOrganization(): HostOrganization | null
  /** React hook. Stable reference while the user does not change. */
  useCurrentUser(): HostUser | null
  /** React hook. */
  usePermission(resource: string, action: PermissionAction): boolean
  /** Routed to the app logger, tagged with the extension id. */
  log: HostLog
  toast(kind: HostToastKind, message: string): void
  /** Per-extension, per-user local UI state, persisted. */
  storage: {
    get<T>(key: string): T | undefined
    set(key: string, value: unknown): void
  }
  registerWorkspace(ws: WorkspaceRegistration): Disposable
  rightPanel: { open(): void; close(): void }
  /**
   * React hook: whether this extension's right panel is showing. It turns false
   * when the user closes the panel or switches to another view (the host closes
   * the panel then), so the extension can clear its own panel state.
   */
  useRightPanelOpen(): boolean
}

export interface NativeExtensionClientModule {
  activate(host: NativeExtensionHost): void | Promise<void>
  deactivate?(): void | Promise<void>
}

/** `window.__BLUEPLM__`: the shared singletons an extension's build maps its imports to. */
export interface BluePLMGlobal {
  apiVersion: 1
  appVersion: string
  modules: Record<'react' | 'react/jsx-runtime' | 'react-dom' | 'lucide-react', unknown>
}

/** Runtime status of one org-installed native extension on this machine. */
export type NativeExtensionStatus = 'loading' | 'active' | 'error' | 'disabled'

export interface NativeExtensionRuntimeState {
  extensionId: string
  version: string
  sha256: string
  status: NativeExtensionStatus
  error?: string
}

/** A row of org_installed_extensions as the renderer reads it (native rows only). */
export interface OrgNativeExtensionRow {
  orgId: string
  extensionId: string
  version: string
  enabled: boolean
  sha256: string
  packagePath: string
  manifest: NativeExtensionManifest
  installedAt: string | null
}
