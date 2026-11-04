/**
 * ui-look Orders scenes (`orders-*`). Every scene resets the order world (lookOrdersFixtures.ts)
 * and rebuilds it through the order RPCs (lookOrdersModel.ts), then puts the app on screen
 * through the store actions the UI calls. Files are the review scenes' project folder.
 *
 * Helpers for `--eval`, on `window.__blueplmLookOrders`: `ids` (order ids by key: `pumpBuild`,
 * `housing`, `spares`, ...), `renderMissing()` records every missing PDF and STEP of the drafts
 * (what Generate missing does with SOLIDWORKS, which the boot does not have), `lastExport` (the
 * request the fake main process got from Export zip), `model` (the RPC model).
 */
import type { usePDMStore } from '@/stores/pdmStore'
import type { Row } from '@/test/fakeSupabase'

import type { PerfBackend } from '../backend'
import {
  buildLookOrderWorld,
  LOOK_MAIN_DRAFT,
  seedLookOrders,
  storeLookOrderPdf,
  storeLookStep,
  type LookOrdersIds,
} from '../lookOrdersFixtures'
import { LookOrdersModel } from '../lookOrdersModel'
import { LOOK_REVIEW_FILE_IDS, LOOK_REVIEW_FILES, LOOK_REVIEW_FOLDER, lookReviewPath } from '../lookReviewFixtures'

type Store = typeof usePDMStore
type ElectronApi = NonNullable<Window['electronAPI']>
type ExportRequest = Parameters<ElectronApi['orders']['export']>[0]

export interface OrdersLookApi {
  ids: Record<string, string>
  model: LookOrdersModel
  renderMissing(): Promise<number>
  /** The lines the context menu would plan for these review files (or the planner's error). */
  plan(names: string[], withReferencedParts?: boolean): Promise<unknown>
  lastExport: (ExportRequest & { verified: number }) | null
}

declare global {
  interface Window {
    __blueplmLookOrders?: OrdersLookApi
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function until<T>(read: () => T | null | undefined | false, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value) return value
    if (Date.now() > deadline) throw new Error('look: timed out waiting for the orders scene')
    await sleep(50)
  }
}

/** The element's own text (its text nodes, not its children's). */
const ownText = (el: Element) =>
  Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? '')
    .join('')
    .trim()
    .toLowerCase()

/** The last visible element whose own text is `text` (case-insensitive). */
const leafWithText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('span, div, td, button'))
    .filter((el) => el.offsetParent !== null && ownText(el) === text.toLowerCase())
    .at(-1)

export function createOrdersLook(store: Store, backend: PerfBackend): Record<string, () => Promise<void>> {
  const { db } = backend
  const fileRow = db.rows('file').find((f) => f.id === LOOK_REVIEW_FILE_IDS['PMP-2000.SLDASM'])
  const ids: LookOrdersIds = {
    orgId: String(fileRow?.org_id ?? ''),
    vaultId: String(fileRow?.vault_id ?? ''),
    userId: String(db.actorId ?? ''),
  }
  const model = new LookOrdersModel(db, ids.orgId)
  model.register(() => db.rows('app_user').find((u) => u.id === db.actorId)?.role === 'admin')
  const ready = seedLookOrders(db, ids)

  // The planner's "drawings that reference these models" read embeds the parent file and version,
  // a shape the typed fake does not answer. Every live drawing edge, with its parent embedded (the
  // override sees no `in` filter; the planner keeps the edges of the models it asked about).
  backend.queryOverrides.push({
    table: 'file_version_reference',
    matches: (select) => select.includes('parent:file!'),
    rows: (eq) => {
      const [from, to] = (eq['@range'] as [number, number] | undefined) ?? [0, Number.MAX_SAFE_INTEGER]
      return db.rows('file_version_reference').flatMap((r) => {
        const parent = db.rows('file').find((f) => f.id === r.parent_file_id)
        const version = db.rows('file_version').find((v) => v.id === r.parent_version_id)
        if (!parent || !version || parent.deleted_at || !/slddrw$/i.test(String(parent.extension))) return []
        return [{
          id: r.id, child_file_id: r.child_file_id, parent_file_id: r.parent_file_id, parent_version_id: r.parent_version_id,
          parent: { file_name: parent.file_name, file_path: parent.file_path, extension: parent.extension, version: parent.version, deleted_at: null },
          parent_version: { version: version.version },
        }]
      }).slice(from, to + 1)
    },
  })

  const api: OrdersLookApi = {
    ids: {},
    model,
    lastExport: null,
    renderMissing: async () => 0,
    async plan(names, withReferencedParts = false) {
      const { planOrderLinesForFiles } = await import('@/lib/orders')
      const wanted = new Set(names.map((n) => n.toLowerCase()))
      const files = store.getState().files.filter((f) => wanted.has(f.name.toLowerCase()))
      try {
        return await planOrderLinesForFiles(files, { withReferencedParts })
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    },
  }
  window.__blueplmLookOrders = api

  // The main process's `orders:export`: downloads each signed URL from the fake bucket and checks
  // its SHA-256, as electron/handlers/orders.ts does; nothing is written.
  const realApi = window.electronAPI as ElectronApi
  const ordersApi: ElectronApi['orders'] = {
    async export(request) {
      let verified = 0
      for (const file of request.files) {
        const prefix = 'fake-storage://vault/'
        const { data } = await db.client.storage.from('vault').download(file.url.slice(prefix.length))
        if (!data) return { success: false, code: 'DOWNLOAD_FAILED', error: `Not found: ${file.path}` }
        const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer())
        const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
        if (hex !== file.sha256) return { success: false, code: 'HASH_MISMATCH', error: file.path }
        verified++
      }
      api.lastExport = { ...request, verified }
      const path = `C:\\Users\\perf\\Downloads\\${request.name}${request.mode === 'zip' ? '.zip' : ''}`
      return { success: true, path, files: request.files.length, bytes: request.files.reduce((n, f) => n + f.size, 0) }
    },
    onExportProgress: () => () => undefined,
  }
  const desktopApi = new Proxy(realApi, {
    get: (target, prop) => (prop === 'orders' ? ordersApi : Reflect.get(target, prop)),
  })
  const setDesktop = (on: boolean) => {
    Object.defineProperty(window, 'electronAPI', { value: on ? desktopApi : undefined, configurable: true, writable: true })
  }
  setDesktop(true)

  // Rows renderMissing added, removed again on reset.
  const generated: Array<[string, Row]> = []
  // The loading scene replaces these two actions; every reset puts them back.
  const realActions = { loadOrders: store.getState().loadOrders, refreshOrder: store.getState().refreshOrder }

  api.renderMissing = async () => {
    let count = 0
    const seen = new Set<string>()
    for (const order of model.orders().filter((o) => o.status === 'draft')) {
      for (const line of model.lines(String(order.id))) {
        for (const kind of model.lineOutputs(line).missing) {
          const drawingKind = kind === 'pdf'
          const versionId = String(drawingKind ? (line.drawing_version_id ?? line.file_version_id) : line.file_version_id)
          const fv = db.rows('file_version').find((v) => v.id === versionId)
          const spec = LOOK_REVIEW_FILES.find((f) => LOOK_REVIEW_FILE_IDS[f.name] === fv?.file_id)
          if (!fv || !spec || seen.has(`${versionId}:${kind}`) || (kind !== 'pdf' && kind !== 'step')) continue
          seen.add(`${versionId}:${kind}`)
          const table = kind === 'pdf' ? 'drawing_pdf_render' : 'file_version_output'
          const before = new Set(db.rows(table as never))
          if (kind === 'pdf') await storeLookOrderPdf(db, ids, spec.name, Number(fv.version))
          else await storeLookStep(db, ids, spec.name, Number(fv.version))
          for (const row of db.rows(table as never)) if (!before.has(row)) generated.push([table, row])
          count++
        }
      }
    }
    const active = store.getState().activeOrderId
    if (active) await store.getState().refreshOrderOutputs(active)
    return count
  }

  const reset = async (world = true) => {
    await ready
    setDesktop(true)
    store.setState(realActions)
    // Close whatever menu or dialog the last scene left open.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    // A file context menu closes on a click on its backdrop.
    document.querySelectorAll<HTMLElement>('[data-native-preview-overlay="context-menu"]').forEach((el) => el.click())
    await sleep(100)
    for (const [table, row] of generated.splice(0)) db.removeRows(table as never, [row])
    model.reset()
    api.lastExport = null
    for (const key of Object.keys(api.ids)) delete api.ids[key]
    if (world) Object.assign(api.ids, buildLookOrderWorld(db, model, ids))
    store.getState().resetOrders()
  }

  const showOrders = async (orderKey: string | null, options: { width?: number } = {}) => {
    const state = store.getState()
    state.closeSettings()
    // Through the action, as the activity bar does, so every view-dependent part follows.
    state.setActiveView('orders')
    store.setState({ sidebarWidth: options.width ?? 300, rightPanelVisible: false, detailsPanelVisible: false })
    await state.loadOrders()
    if (orderKey) {
      const id = api.ids[orderKey]
      await store.getState().openOrder(id)
      await until(() => store.getState().orderOutputStates[id] || store.getState().orderErrors[id])
    }
    await sleep(400)
  }

  const showExplorer = (select: string[]) => {
    const state = store.getState()
    state.closeSettings()
    store.setState({ activeView: 'explorer', sidebarWidth: 260, detailsPanelVisible: false, rightPanelVisible: false })
    state.setCurrentFolder(LOOK_REVIEW_FOLDER)
    const root = state.vaultPath ?? ''
    state.setSelectedFiles(select.map((n) => lookReviewPath(root, n)))
  }

  const rightClick = async (name: string) => {
    const target = await until(() => leafWithText(name))
    const box = target.getBoundingClientRect()
    target.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: box.left + 10, clientY: box.top + box.height / 2 }),
    )
    await sleep(300)
  }

  const clickText = async (text: string) => {
    const el = await until(() => leafWithText(text))
    el.click()
    await sleep(300)
  }

  return {
    // The Orders view with no order anywhere.
    'orders-empty': async () => {
      await reset(false)
      await showOrders(null)
    },
    // Every status in the list (filter All), the sent order open.
    'orders-list': async () => {
      await reset()
      await showOrders('housing')
      await clickText('All')
    },
    // The main draft: ready / missing / not-included chips, an older pin with Update, a purged
    // line and the hidden-lines note.
    'orders-detail-draft': async () => {
      await reset()
      await showOrders(LOOK_MAIN_DRAFT)
    },
    // A sent order: frozen lines, what went out (one kind missing, sent anyway).
    'orders-detail-sent': async () => {
      await reset()
      await showOrders('housing')
    },
    // Mark sent on the main draft: the missing-outputs dialog.
    'orders-send-dialog-missing': async () => {
      await reset()
      await showOrders(LOOK_MAIN_DRAFT)
      await clickText('Mark sent')
    },
    // File list right-click on an assembly and a drawing, Orders submenu open.
    'orders-context-menu': async () => {
      await reset()
      await store.getState().loadOrders()
      showExplorer(['PMP-2000.SLDASM', 'PMP-2001.SLDDRW'])
      await sleep(400)
      await rightClick('PMP-2001.SLDDRW')
      const item = await until(() =>
        Array.from(document.querySelectorAll<HTMLElement>('.context-menu-item')).find((el) => ownText(el) === 'orders'),
      )
      item.click()
      // The menu paints a moment after it opens.
      await sleep(900)
    },
    // Version history of a part, the Order menu of its latest version open.
    'orders-version-history': async () => {
      await reset()
      await store.getState().loadOrders()
      showExplorer(['PMP-2001.SLDPRT'])
      await sleep(500)
      const name = await until(() => leafWithText('PMP-2001.SLDPRT'))
      const row = name.closest('[data-index], tr, [role="row"]') ?? name.parentElement?.parentElement
      const trigger = await until(() => row?.querySelector<HTMLElement>('[title="Click to view version history"]'))
      trigger.click()
      await sleep(800)
      const order = await until(() => document.querySelector<HTMLElement>('button[aria-haspopup="menu"][aria-label^="Add version"]'))
      order.click()
      await sleep(300)
    },
    // The list and the order still loading (their loads never finish).
    'orders-loading': async () => {
      await reset()
      const pending = () => new Promise<void>(() => undefined)
      store.setState({ loadOrders: pending, refreshOrder: pending, ordersLoading: true })
      const state = store.getState()
      state.closeSettings()
      state.setActiveView('orders')
      store.setState({ sidebarWidth: 300, rightPanelVisible: false, activeOrderId: api.ids[LOOK_MAIN_DRAFT] })
      await sleep(400)
    },
    // The list failed to load (pane), and an order that failed to open (main area).
    'orders-error': async () => {
      await reset()
      const failure = { message: 'connection refused (look scene)', code: '08006' }
      // The pane may load the list too: every list read fails, then the spare failures go.
      for (let i = 0; i < 3; i++) db.failNext('supply_order' as never, 'select', failure)
      await showOrders(null)
      while (db.takeInjectedFailure('supply_order', 'select')) {
        // drained
      }
      // The view loads the opened order itself; both of its line reads fail.
      db.failNext('supply_order_line' as never, 'select', failure)
      db.failNext('supply_order_line' as never, 'select', failure)
      store.setState({ activeOrderId: api.ids[LOOK_MAIN_DRAFT] })
      await until(() => store.getState().orderErrors[api.ids[LOOK_MAIN_DRAFT]])
      await sleep(300)
    },
    // BluePLM Web: no Generate missing, no Save to folder, Export zip only.
    'orders-web': async () => {
      await reset()
      setDesktop(false)
      await showOrders(LOOK_MAIN_DRAFT)
    },
    // The main draft in a narrow window (run with --size 1000x800) and a narrow list pane.
    'orders-narrow': async () => {
      await reset()
      await showOrders(LOOK_MAIN_DRAFT, { width: 240 })
    },
    // The flow's start: the project folder in the file list, orders in the world.
    'orders-flow-start': async () => {
      await reset()
      await store.getState().loadOrders()
      showExplorer([])
      await sleep(300)
    },
  }
}
