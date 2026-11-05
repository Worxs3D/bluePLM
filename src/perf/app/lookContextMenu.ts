/**
 * ui-look scenes for the right-click menu customizer: Settings > Right-click menu (following a
 * template with pins and hidden actions; a person's own layout with STEP pinned first), Settings >
 * Menu templates (an admin with two templates), and the real right-click menus (file list and
 * explorer tree) opened the way a person opens them, by a `contextmenu` event on a file's row.
 * The organization's menu settings go into both the store and the fake backend's `organization`
 * row, so the admin page's saves read back what the scene shows.
 */
import type { usePDMStore } from '@/stores/pdmStore'
import type { MenuLayout, OrgContextMenuSettings, UserContextMenuPrefs } from '@/lib/contextMenu/types'

import type { PerfBackend } from './backend'

type Store = typeof usePDMStore

const DAY = 86_400_000
const DRAFTING_ID = '00000000-0000-4000-8000-c0a7e0000001'
const SHOP_ID = '00000000-0000-4000-8000-c0a7e0000002'

async function lookTemplates(now: number): Promise<OrgContextMenuSettings> {
  const { DEFAULT_LAYOUT } = await import('@/lib/contextMenu/entries')
  const { addGroup, hideEntry, pinEntry } = await import('@/lib/contextMenu/edit')
  // Drafting: exports first, in a group of their own.
  let drafting: MenuLayout = addGroup(DEFAULT_LAYOUT, {
    id: 'g-export01',
    label: 'Export to',
    icon: 'export',
    display: 'submenu',
    at: { parent: [], index: 0 },
    entries: ['generate.local.step', 'generate.local.pdf', 'generate.local.dxf'],
  })
  drafting = hideEntry(drafting, 'duplicate.partAndDrawing')
  // Shop floor: download and properties first, nothing to delete.
  let shop: MenuLayout = pinEntry(DEFAULT_LAYOUT, 'collab.properties')
  shop = pinEntry(shop, 'sync.download')
  for (const id of ['delete.deleteLocal', 'delete.everywhere', 'delete.serverKeepLocal'] as const) shop = hideEntry(shop, id)
  return {
    templates: [
      {
        id: DRAFTING_ID,
        name: 'Drafting',
        description: 'Exports first, for the drawing office',
        layout: drafting,
        updated_at: new Date(now - 3 * DAY).toISOString(),
      },
      {
        id: SHOP_ID,
        name: 'Shop floor',
        description: 'Download and properties first, no deletes',
        layout: shop,
        updated_at: new Date(now - 12 * DAY).toISOString(),
      },
    ],
    default_template_id: DRAFTING_ID,
  }
}

function setOrgMenu(store: Store, backend: PerfBackend, contextMenu: OrgContextMenuSettings): void {
  const org = store.getState().organization
  if (!org) throw new Error('look: no organization in the store')
  const settings = { ...(org.settings ?? {}), context_menu: contextMenu }
  store.setState({ organization: { ...org, settings } as typeof org })
  const row = backend.db.rows('organization').find((r) => r.id === org.id)
  if (row) row.settings = { ...((row.settings as Record<string, unknown> | null) ?? {}), context_menu: contextMenu }
}

async function setPrefs(store: Store, prefs: UserContextMenuPrefs | null): Promise<void> {
  const { orgKey } = await import('@/lib/contextMenu/effective')
  store.getState().setContextMenuPrefs(orgKey(store.getState().organization?.id), prefs)
}

/** The look part (in the inspection folder of the file list scene). */
const LOOK_PART = 'BR-103849-201.SLDPRT'

async function until(check: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('look: timed out waiting for the menu scene')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** A person's own layout: Export STEP first, then a "Mine" flyout, two entries hidden. */
async function customLayout(): Promise<MenuLayout> {
  const { DEFAULT_LAYOUT } = await import('@/lib/contextMenu/entries')
  const { addGroup, addSeparator, hideEntry, pinEntry } = await import('@/lib/contextMenu/edit')
  let custom = pinEntry(DEFAULT_LAYOUT, 'generate.local.step')
  custom = addGroup(custom, {
    id: 'g-mine0001',
    label: 'Mine',
    icon: 'star',
    display: 'submenu',
    at: { parent: [], index: 1 },
    entries: ['collab.whereUsed', 'collab.properties', 'fileActions.copyName'],
  })
  custom = addSeparator(custom, { parent: [], index: 2 })
  custom = hideEntry(custom, 'delete.deleteLocal')
  return hideEntry(custom, 'edit.cut')
}

/** Closes a menu left open by an earlier scene the way a person does: Escape, then a click. */
async function closeOpenMenu(): Promise<void> {
  if (!document.querySelector('.context-menu')) return
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  const backdrop = document.querySelector<HTMLElement>('[data-native-preview-overlay="context-menu"]') ?? document.body
  backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await until(() => !document.querySelector('.context-menu'), 3000).catch(() => undefined)
}

/** Right-clicks the row of `name` in `scope` (the file list table or the explorer tree). */
async function rightClick(name: string, scope: 'list' | 'tree'): Promise<void> {
  const selector = scope === 'list' ? `tr[data-path$="${name}"]` : `:not(tr)[data-path$="${name}"]`
  await closeOpenMenu()
  await until(() => !!document.querySelector(selector))
  const row = document.querySelector<HTMLElement>(selector)!
  row.scrollIntoView({ block: 'center' })
  const rect = row.getBoundingClientRect()
  row.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: rect.left + Math.min(120, rect.width / 2),
      clientY: rect.top + rect.height / 2,
    }),
  )
  await until(() => !!document.querySelector('.context-menu'))
}

/** The file list of the inspection folder (the look's own scene), with the person's layout. */
async function openFileList(store: Store, custom: MenuLayout | null): Promise<void> {
  await setPrefs(store, custom ? { templateId: null, pinned: [], hidden: [], custom } : null)
  const look = window.__blueplmLook
  if (!look) throw new Error('look: no look control')
  await look.scene('inspection-file-list')
}

/**
 * Drags the editor row `from` onto the top edge of the row `onto`, through the same DOM drag
 * events a mouse makes, with a pause between them so React commits each step. Stops before the
 * drop when `drop` is false (the drop indicator is showing).
 */
async function dragRow(from: string, onto: string, drop: boolean): Promise<void> {
  const pause = () => new Promise((resolve) => setTimeout(resolve, 120))
  const row = (key: string) => document.querySelector<HTMLElement>(`[data-editor-row='${key}']`)
  await until(() => !!row(from) && !!row(onto))
  const source = row(from)!
  const target = row(onto)!
  const dataTransfer = new DataTransfer()
  source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
  await pause()
  const rect = target.getBoundingClientRect()
  const at = { clientX: rect.left + 60, clientY: rect.top + 4 }
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, ...at }))
  await pause()
  if (!drop) return
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, ...at }))
  source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }))
  await pause()
  const first = document.querySelector<HTMLElement>('[data-editor-row]')?.dataset.editorRow
  if (first !== from) throw new Error(`look: the drag did not reorder (first row ${first})`)
}

export function contextMenuLookScenes(store: Store, backend: PerfBackend): Record<string, () => Promise<void>> {
  const scenes: Record<string, () => Promise<void>> = {
    // Settings > Right-click menu: following the org default (Drafting) with two pins and a hidden action.
    'settings-context-menu': async () => {
      await closeOpenMenu()
      const now = Date.now()
      setOrgMenu(store, backend, await lookTemplates(now))
      await setPrefs(store, {
        templateId: null,
        pinned: ['generate.local.step', 'checkout.checkIn'],
        hidden: ['fileActions.copyFolderPath'],
        custom: null,
        updatedAt: new Date(now - DAY).toISOString(),
      })
      store.getState().openSettings('context-menu')
    },
    // The same page with the person's own layout: STEP pinned first, their own "Mine" section,
    // the editor open; Drafting has changed since they started.
    'settings-context-menu-custom': async () => {
      await closeOpenMenu()
      const now = Date.now()
      const templates = await lookTemplates(now)
      setOrgMenu(store, backend, templates)
      const { DEFAULT_LAYOUT } = await import('@/lib/contextMenu/entries')
      const { addGroup, addSeparator, hideEntry, pinEntry } = await import('@/lib/contextMenu/edit')
      let custom = pinEntry(DEFAULT_LAYOUT, 'generate.local.step')
      custom = addSeparator(custom, { parent: [], index: 1 })
      custom = addGroup(custom, {
        id: 'g-mine0001',
        label: 'Mine',
        icon: 'star',
        display: 'inline',
        at: { parent: [], index: 2 },
        entries: ['generate.local.pdf', 'collab.whereUsed'],
      })
      custom = hideEntry(custom, 'delete.deleteLocal')
      custom = hideEntry(custom, 'edit.cut')
      await setPrefs(store, {
        templateId: null,
        pinned: [],
        hidden: [],
        custom,
        // An older hash of Drafting, so the page says the template has changed since.
        customizedFrom: { templateId: DRAFTING_ID, baseHash: 'look-older-drafting' },
        updatedAt: new Date(now - DAY).toISOString(),
      })
      store.getState().openSettings('context-menu')
    },
    // The file list's menu on a part, with the app default layout.
    'context-menu-list-default': async () => {
      setOrgMenu(store, backend, { templates: [] })
      await openFileList(store, null)
      await rightClick(LOOK_PART, 'list')
    },
    // The same menu with the person's layout: Export STEP first, then their "Mine" flyout.
    'context-menu-list-custom': async () => {
      setOrgMenu(store, backend, { templates: [] })
      await openFileList(store, await customLayout())
      await rightClick(LOOK_PART, 'list')
    },
    // The custom menu with the pinned Export STEP flyout open (Export Here / Export To…).
    'context-menu-list-flyout': async () => {
      setOrgMenu(store, backend, { templates: [] })
      await openFileList(store, await customLayout())
      await rightClick(LOOK_PART, 'list')
      const row = [...document.querySelectorAll<HTMLElement>('.context-menu .context-menu-item')].find((el) =>
        (el.textContent ?? '').trim().startsWith('Export STEP'),
      )
      if (!row) throw new Error('look: no Export STEP row')
      // React's onMouseEnter listens to mouseover from outside the row.
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
      await until(() => !!row.querySelector('[data-context-submenu]'))
    },
    // The explorer tree's menu on the same part, with the same layout.
    'context-menu-tree-custom': async () => {
      setOrgMenu(store, backend, { templates: [] })
      await openFileList(store, await customLayout())
      const folders = ['P00', 'P00/Assy-00', 'P00/Assy-00/Sub-00']
      store.setState({ expandedFolders: new Set([...store.getState().expandedFolders, ...folders]) })
      await rightClick(LOOK_PART, 'tree')
    },
    // The editor mid-drag: Open dragged onto the top edge of Export STEP (drop line showing).
    'settings-context-menu-drag': async () => {
      await scenes['settings-context-menu-custom']()
      await dragRow('e:open.open', 'e:generate.local.step', false)
    },
    // The same drag dropped: Open is now the first entry (the scene throws if it is not).
    'settings-context-menu-dropped': async () => {
      await scenes['settings-context-menu-custom']()
      await dragRow('e:open.open', 'e:generate.local.step', true)
    },
    // Settings > Menu templates (admin): Drafting (the default) and Shop floor, Drafting open.
    'settings-context-menu-templates': async () => {
      await closeOpenMenu()
      setOrgMenu(store, backend, await lookTemplates(Date.now()))
      store.getState().openSettings('context-menu-templates')
    },
  }
  return scenes
}
