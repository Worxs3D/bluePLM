/**
 * Native extension runtime (API side). See
 * `.cursor/plans/extensions-native-runtime.plan.md`, "API loading".
 */

import { log } from '../infrastructure/logging.js'
import { createSupabaseAdminClient } from '../infrastructure/supabase.js'
import { NativeExtensionRuntime } from './runtime.js'
import { createSupabaseNativeExtensionStore } from './store.js'

export { NativeExtensionRuntime, DEFAULT_EXTRACT_ROOT, validateRoute } from './runtime.js'
export type { LoadedNativeExtension, ReloadReport, NativeExtensionRuntimeOptions } from './runtime.js'
export { nativeExtensionRoutes, DEFAULT_ROUTE_TIMEOUT_MS } from './routes.js'
export type { NativeExtensionRoutesOptions } from './routes.js'
export {
  createSupabaseNativeExtensionStore,
  pickLatestInstalls,
  NATIVE_PACKAGE_BUCKET,
} from './store.js'
export type { NativeExtensionStore, NativeInstallRow, OrgInstall } from './store.js'
export {
  verifyPackageBytes,
  verifyAndExtractPackage,
  sha256Hex,
  PackageHashMismatchError,
  InvalidPackageError,
} from './package.js'
export * from './types.js'

let singleton: NativeExtensionRuntime | null | undefined

/**
 * The process-wide runtime, or null when the API has no service-role key
 * (native packages and installs are only readable with it).
 */
export function getNativeExtensionRuntime(): NativeExtensionRuntime | null {
  if (singleton !== undefined) return singleton
  try {
    const admin = createSupabaseAdminClient()
    singleton = new NativeExtensionRuntime({
      store: createSupabaseNativeExtensionStore(admin),
      supabaseAdmin: admin,
      logger: log,
    })
  } catch (err) {
    log.warn({ err }, '[NativeExtensions] Disabled: the service-role client is not configured')
    singleton = null
  }
  return singleton
}
