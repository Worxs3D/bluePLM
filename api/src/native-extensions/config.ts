/**
 * Operator configuration for native extensions.
 *
 * A native extension's server code runs in-process with the API's full
 * privileges, including the service-role Supabase client that can read every
 * organization's data. An org admin choosing to install one is therefore not
 * enough: the API operator must also trust that organization. Only orgs listed in
 * NATIVE_EXTENSIONS_ORG_IDS get native extensions loaded; unset means none.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Parse NATIVE_EXTENSIONS_ORG_IDS (comma-separated UUIDs). Unset or blank is an
 * empty list. Throws, naming the bad entries, on anything that is not a UUID.
 */
export function parseNativeExtensionOrgIds(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return []
  const ids = value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
  const bad = ids.filter((id) => !UUID.test(id))
  if (bad.length > 0) {
    throw new Error(`must be comma-separated organization UUIDs (not ${JSON.stringify(bad)})`)
  }
  return [...new Set(ids)]
}

/**
 * A private directory for extracted packages: a fresh mkdtemp under `baseDir`
 * (NATIVE_EXTENSIONS_DIR, else the OS temp dir), mode 0700, so no other local
 * user can read or plant files next to code the API imports.
 */
export function createPrivateExtractRoot(baseDir: string = os.tmpdir()): string {
  fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 })
  const dir = fs.mkdtempSync(path.join(baseDir, 'blueplm-native-'))
  fs.chmodSync(dir, 0o700)
  return dir
}
