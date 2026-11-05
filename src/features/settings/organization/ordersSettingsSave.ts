/**
 * Writing `organization.settings.orders` (Settings > Orders): read the organization's current
 * settings, merge the patch into their `orders` key, write the whole object back. A failed or
 * empty read aborts the save, because writing from the store's cached copy could put back an old
 * value of a key someone else changed meanwhile.
 */

import type { OrderOrgSettings, OrgSettings } from '@/types/pdm'

type DbError = { message: string } | null

export interface OrderSettingsSaveDeps {
  read: () => PromiseLike<{ data: { settings: unknown } | null; error: DbError }>
  write: (settings: OrgSettings) => PromiseLike<{ data: unknown; error: DbError }>
}

export type OrderSettingsSaveResult =
  | { ok: true; settings: OrgSettings }
  /** `read_failed`: nothing was written. `no_row`: the row could not be read or written (no permission). */
  | { ok: false; reason: 'read_failed' | 'write_failed' | 'no_row'; message: string }

/** `patch` merged into `base.orders` (`default_kinds` merged per line class). Pure. */
export function mergeOrderSettings(base: OrgSettings, patch: OrderOrgSettings): OrgSettings {
  const orders: OrderOrgSettings = typeof base.orders === 'object' && base.orders !== null ? base.orders : {}
  return {
    ...base,
    orders: {
      ...orders,
      ...patch,
      ...(patch.default_kinds ? { default_kinds: { ...orders.default_kinds, ...patch.default_kinds } } : {}),
    },
  }
}

export async function saveOrderOrgSettings(
  patch: OrderOrgSettings,
  deps: OrderSettingsSaveDeps,
): Promise<OrderSettingsSaveResult> {
  const fresh = await deps.read()
  if (fresh.error) return { ok: false, reason: 'read_failed', message: fresh.error.message }
  if (!fresh.data) return { ok: false, reason: 'no_row', message: 'The organization could not be read' }
  const settings = mergeOrderSettings((fresh.data.settings ?? {}) as OrgSettings, patch)
  const written = await deps.write(settings)
  if (written.error) return { ok: false, reason: 'write_failed', message: written.error.message }
  if (!written.data) return { ok: false, reason: 'no_row', message: 'The organization could not be written' }
  return { ok: true, settings }
}
