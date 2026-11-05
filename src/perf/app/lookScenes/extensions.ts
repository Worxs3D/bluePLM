/**
 * ui-look official extension scenes (`extensions-*`): Settings > Extensions with Reviews,
 * Inspection and Orders installed or not, the install and uninstall confirmations, and the app with
 * each one uninstalled (no Reviews or Orders in the activity bar, no Inspection tab on a drawing, no
 * Reviews or Orders submenu). Each scene starts from a reset: it writes the install state on the
 * organization row and in the store, as `org_extension_set_installed()` (schema 516) would.
 *
 * Run as a member with `--as` to see the read-only catalog. `window.__blueplmLookExtensions.set(id,
 * installed)` changes one extension for `--eval`.
 */
import type { usePDMStore } from '@/stores/pdmStore'
import type { Row } from '@/test/fakeSupabase'
import type { OfficialExtensionId } from '@/lib/officialExtensions'
import type { OrgSettings } from '@/types/pdm'

import type { PerfBackend } from '../backend'

type Store = typeof usePDMStore

declare global {
  interface Window {
    __blueplmLookExtensions?: { set(id: OfficialExtensionId, installed: boolean): void }
  }
}

const KNOWN: readonly OfficialExtensionId[] = ['blueplm.reviews', 'blueplm.inspection', 'blueplm.orders']

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function clickWhenReady(selector: string, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const el = document.querySelector<HTMLElement>(selector)
    if (el) {
      el.click()
      return
    }
    if (Date.now() > deadline) throw new Error(`look: ${selector} did not appear`)
    await sleep(50)
  }
}

export interface ExtensionsLookHelpers {
  /**
   * The explorer with the ballooned drawing selected and its Inspection tab asked for: with
   * Inspection uninstalled the details panel shows another tab instead.
   */
  showDrawing(): void
}

export function createExtensionsLook(
  store: Store,
  backend: PerfBackend,
  helpers: ExtensionsLookHelpers,
): Record<string, () => Promise<void>> {
  const { db } = backend

  const orgRow = (): Row | undefined => {
    const id = store.getState().organization?.id
    return db.rows('organization').find((o) => o.id === id)
  }

  /** Write the install state on the row and in the store; `uninstalled` lists the ones not installed. */
  const setState = (uninstalled: readonly OfficialExtensionId[]) => {
    const org = store.getState().organization
    if (!org) throw new Error('look: no organization')
    const extensions = Object.fromEntries(
      uninstalled.map((id) => [id, { installed: false, changed_at: new Date().toISOString() }]),
    )
    const settings: OrgSettings = { ...org.settings, extensions: uninstalled.length ? extensions : undefined }
    const row = orgRow()
    if (row) row.settings = settings
    store.getState().setOrganization({ ...org, settings })
  }

  // The server side of Install / Uninstall (migration 516): admin only, known ids, no dependencies
  // between the three today.
  db.defineRpc(
    'org_extension_set_installed',
    (args) => {
      const id = String(args.p_extension_id) as OfficialExtensionId
      const isAdmin = db.rows('app_user').find((u) => u.id === db.actorId)?.role === 'admin'
      if (!isAdmin) return { success: false, error_code: 'NOT_ADMIN', error_message: 'Admins only' }
      if (!KNOWN.includes(id)) return { success: false, error_code: 'UNKNOWN_EXTENSION', error_message: id }
      const row = orgRow()
      const settings = { ...((row?.settings as OrgSettings | undefined) ?? {}) } as OrgSettings
      settings.extensions = {
        ...(settings.extensions ?? {}),
        [id]: { installed: args.p_installed === true, changed_at: new Date().toISOString(), changed_by: String(db.actorId) },
      }
      if (row) row.settings = settings
      return { success: true, settings }
    },
    { untyped: true },
  )

  window.__blueplmLookExtensions = {
    set: (id, installed) => {
      const current = KNOWN.filter((x) => (store.getState().organization?.settings.extensions?.[x]?.installed ?? true) === false)
      setState(installed ? current.filter((x) => x !== id) : [...new Set([...current, id])])
    },
  }

  const openCatalog = (uninstalled: readonly OfficialExtensionId[]) => {
    setState(uninstalled)
    store.getState().openSettings('extensions')
  }

  return {
    // All three installed (every organization after the upgrade).
    'extensions-catalog': async () => openCatalog([]),
    // Inspection and Orders uninstalled.
    'extensions-catalog-mixed': async () => openCatalog(['blueplm.inspection', 'blueplm.orders']),
    // The uninstall confirmation of Reviews (the one with effects on core flows).
    'extensions-uninstall-reviews': async () => {
      openCatalog([])
      await clickWhenReady('[data-extension-id="blueplm.reviews"] button')
    },
    'extensions-uninstall-inspection': async () => {
      openCatalog([])
      await clickWhenReady('[data-extension-id="blueplm.inspection"] button')
    },
    // The install confirmation of Orders.
    'extensions-install-orders': async () => {
      openCatalog(['blueplm.orders'])
      await clickWhenReady('[data-extension-id="blueplm.orders"] button')
    },
    // The app with all three uninstalled: no Reviews or Orders view, no Inspection tab.
    'extensions-none-installed': async () => {
      setState(KNOWN)
      store.getState().closeSettings()
      helpers.showDrawing()
    },
    // The same drawing with all three installed, to compare.
    'extensions-all-installed': async () => {
      setState([])
      store.getState().closeSettings()
      helpers.showDrawing()
    },
  }
}
