/**
 * Install or uninstall an official extension for the signed-in organization (schema 516). The only
 * writer of `organization.settings.extensions`: `org_extension_set_installed()` is SECURITY
 * DEFINER, admin only, knows the ids, applies the dependency rules of
 * `src/lib/officialExtensions/dependencies.ts` and changes the one key in place, so it never
 * races another settings write. It returns the organization's new settings.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { getSupabaseClient } from '@/lib/supabase/client'
import type { OfficialExtensionId } from '@/lib/officialExtensions'
import type { OrgSettings } from '@/types/pdm'

export const SET_INSTALLED_ERROR_CODES = [
  'NOT_ADMIN',
  'UNKNOWN_EXTENSION',
  'DEPENDENCY_INSTALLED',
  'DEPENDENCY_MISSING',
  'NEEDS_UPGRADE',
] as const

export type SetInstalledErrorCode = (typeof SET_INSTALLED_ERROR_CODES)[number]

export type SetInstalledResult =
  | { ok: true; settings: OrgSettings }
  | { ok: false; code: SetInstalledErrorCode | null; message: string }

function db(): SupabaseClient {
  return getSupabaseClient() as unknown as SupabaseClient
}

function codeOf(value: unknown): SetInstalledErrorCode | null {
  return SET_INSTALLED_ERROR_CODES.find((c) => c === value) ?? null
}

export async function setOfficialExtensionInstalled(
  id: OfficialExtensionId,
  installed: boolean,
): Promise<SetInstalledResult> {
  const { data, error } = await db().rpc('org_extension_set_installed', {
    p_extension_id: id,
    p_installed: installed,
  })
  if (error) {
    // PGRST202: the function does not exist yet (a database below 516).
    if (error.code === 'PGRST202' || error.code === '42883') {
      return { ok: false, code: 'NEEDS_UPGRADE', message: error.message }
    }
    return { ok: false, code: codeOf(error.hint), message: error.message }
  }
  const result = (data ?? {}) as { success?: boolean; error_code?: string; error_message?: string; settings?: OrgSettings }
  if (!result.success || !result.settings) {
    return { ok: false, code: codeOf(result.error_code), message: result.error_message ?? 'Refused' }
  }
  return { ok: true, settings: result.settings }
}
