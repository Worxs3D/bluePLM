/**
 * ui-look Orders scenes (`orders-*`). Every scene resets the order world (lookOrdersFixtures.ts)
 * and rebuilds it through the order RPCs (lookOrdersModel.ts), then puts the app on screen
 * through the store actions the UI calls. Files are the review scenes' project folder.
 *
 * Helpers for `--eval`, on `window.__blueplmLookOrders`: `ids` (order ids by key: `pumpBuild`,
 * `housing`, `spares`, ...), `renderMissing()` records every missing PDF and STEP of the drafts
 * (what Generate missing does with SOLIDWORKS, which the boot does not have), `lastExport` (the
 * request the fake main process got from Export zip), `model` (the RPC model),
 * `fulfilRequests()` (a desktop with SOLIDWORKS generating every requested output, 5.13.0) and
 * `dragFiles(names, selector, drop)` (drag review files from the file list onto an element).
 */
import type { usePDMStore } from '@/stores/pdmStore'
import type { Row } from '@/test/fakeSupabase'

import type { PerfBackend } from '../backend'
import {
  buildLookOrderWorld,
  LOOK_MAIN_DRAFT,
  LOOK_SUPPLIERS,
  seedLookOrders,
  storeLookOrderPdf,
  storeLookStep,
  type LookOrdersIds,
} from '../lookOrdersFixtures'
import { LookOrdersModel } from '../lookOrdersModel'
import {
  LOOK_REVIEW_FILE_IDS,
  LOOK_REVIEW_FILES,
  LOOK_REVIEW_FOLDER,
  lookReviewPath,
  lookReviewVersionId,
} from '../lookReviewFixtures'

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
  /** Generate every requested output (as a desktop with SOLIDWORKS would) and settle the requests. */
  fulfilRequests(): Promise<number>
  /** Drag these review files (by name) over the first element matching `selector`; `drop` drops them. */
  dragFiles(names: string[], selector: string, drop?: boolean): Promise<void>
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
    fulfilRequests: async () => 0,
    dragFiles: async () => undefined,
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

  // A scene's extra drawing reference (Choose drawing), removed again on reset.
  const extraRefs: Row[] = []

  /** A desktop with SOLIDWORKS (Generate missing), or one without (Request missing). */
  const setSolidWorks = (installed: boolean) => {
    store.getState().setSolidworksServiceStatus({ running: installed, swInstalled: installed, version: installed ? '1.29.0' : undefined })
  }

  const reset = async (world = true) => {
    await ready
    setDesktop(true)
    setSolidWorks(true)
    store.setState(realActions)
    if (extraRefs.length > 0) db.removeRows('file_version_reference', extraRefs.splice(0) as never)
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

  api.fulfilRequests = async () => {
    let count = 0
    for (const req of db.rows('version_output_request' as never)) {
      if (req.status !== 'pending' && req.status !== 'claimed') continue
      const fv = db.rows('file_version').find((v) => v.id === req.file_version_id)
      const spec = LOOK_REVIEW_FILES.find((f) => LOOK_REVIEW_FILE_IDS[f.name] === fv?.file_id)
      if (!fv || !spec) continue
      const table = req.kind === 'pdf' ? 'drawing_pdf_render' : 'file_version_output'
      const before = new Set(db.rows(table as never))
      if (req.kind === 'pdf') await storeLookOrderPdf(db, ids, spec.name, Number(fv.version))
      else if (req.kind === 'step') await storeLookStep(db, ids, spec.name, Number(fv.version))
      else continue
      for (const row of db.rows(table as never)) if (!before.has(row)) generated.push([table, row])
      count++
    }
    model.settleRequests()
    const active = store.getState().activeOrderId
    if (active) await store.getState().refreshOrderOutputs(active)
    return count
  }

  // An HTML5 drag from the file list: the same `application/x-plm-files` data its rows put on it.
  api.dragFiles = async (names, selector, drop = false) => {
    const target = await until(() => document.querySelector<HTMLElement>(selector))
    const transfer = new DataTransfer()
    transfer.setData('application/x-plm-files', JSON.stringify(names.map((n) => `${LOOK_REVIEW_FOLDER}/${n}`)))
    const box = target.getBoundingClientRect()
    const at = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: box.left + 20, clientY: box.top + 10 }
    target.dispatchEvent(new DragEvent('dragenter', at))
    target.dispatchEvent(new DragEvent('dragover', at))
    if (drop) target.dispatchEvent(new DragEvent('drop', at))
    await sleep(drop ? 900 : 300)
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
    // BluePLM Web: Request missing instead of Generate missing; Save to folder only where the
    // browser has showDirectoryPicker (Chromium, so the harness shows it).
    'orders-web': async () => {
      await reset()
      setDesktop(false)
      await showOrders(LOOK_MAIN_DRAFT)
    },
    // 5.13.0: the web user's Request missing went out: Requested chips, the note, Cancel requests.
    'orders-requested': async () => {
      await reset()
      setDesktop(false)
      await showOrders(LOOK_MAIN_DRAFT)
      await clickText('Request 2 missing')
      await until(() => document.body.textContent?.includes('Cancel requests'))
      await sleep(300)
    },
    // A desktop without SOLIDWORKS: Request missing, as on the web, and Save files to folder.
    'orders-no-solidworks': async () => {
      await reset()
      setSolidWorks(false)
      await showOrders(LOOK_MAIN_DRAFT)
    },
    // After the requests: a desktop with SOLIDWORKS generated them; the chips are ready.
    'orders-requested-done': async () => {
      await reset()
      setDesktop(false)
      await showOrders(LOOK_MAIN_DRAFT)
      await clickText('Request 2 missing')
      await until(() => document.body.textContent?.includes('Cancel requests'))
      await api.fulfilRequests()
      await sleep(300)
    },
    // Choose drawing on the housing line: two drawings reference it (the assembly drawing too).
    'orders-choose-drawing': async () => {
      await reset()
      const latest = LOOK_REVIEW_FILES.find((f) => f.name === 'PMP-2000.SLDDRW')!.version
      const parentVersion = db.rows('file_version').find(
        (v) => v.file_id === LOOK_REVIEW_FILE_IDS['PMP-2000.SLDDRW'] && Number(v.version) === latest,
      )
      extraRefs.push(
        db.seed('file_version_reference', {
          org_id: ids.orgId,
          parent_file_id: LOOK_REVIEW_FILE_IDS['PMP-2000.SLDDRW'],
          parent_version_id: String(parentVersion?.id ?? ''),
          child_file_id: LOOK_REVIEW_FILE_IDS['PMP-2001.SLDPRT'],
          child_version_id: null,
          child_path: `${LOOK_REVIEW_FOLDER}/PMP-2001.SLDPRT`,
          reference_type: 'reference',
          is_exact: true,
        }) as unknown as Row,
      )
      await showOrders(LOOK_MAIN_DRAFT)
      const button = await until(() =>
        Array.from(document.querySelectorAll<HTMLElement>('button[aria-label="Choose the drawing of PMP-2001"]')).find(
          (b) => b.offsetParent !== null,
        ),
      )
      button.click()
      await until(() => document.querySelector('[role="menu"]')?.textContent?.includes('No drawing'))
      await sleep(300)
    },
    // A file list drag held over a draft in the list (Spare impellers).
    'orders-drop-hover': async () => {
      await reset()
      await showOrders(LOOK_MAIN_DRAFT)
      await api.dragFiles(['PMP-2003.SLDPRT'], '[role="listbox"] [role="presentation"]:nth-child(2)')
    },
    // The same drag held over the open draft.
    'orders-drop-hover-detail': async () => {
      await reset()
      await showOrders(LOOK_MAIN_DRAFT)
      await api.dragFiles(['PMP-2003.SLDPRT'], '[data-order-drop="detail"]')
    },
    // Files dropped on Sam's draft (Spare impellers): added like Add to order.
    'orders-drop-added': async () => {
      await reset()
      await showOrders('spares')
      await api.dragFiles(['PMP-2003.SLDPRT', 'PMP-2004.SLDDRW'], '[data-order-drop="detail"]', true)
      await until(() => (store.getState().orderLines[api.ids.spares]?.length ?? 0) >= 3)
      await sleep(400)
    },
    // The Orders tab of the file details pane: the housing part is in several orders.
    'orders-file-details': async () => {
      await reset()
      await store.getState().loadOrders()
      showExplorer(['PMP-2001.SLDPRT'])
      store.setState({ detailsPanelVisible: true })
      store.getState().setDetailsPanelTab('orders')
      await until(() => document.body.textContent?.includes('Pump assembly, rev B build'))
      await sleep(400)
    },
    // The same tab for a file in no order.
    'orders-file-details-empty': async () => {
      await reset()
      await store.getState().loadOrders()
      showExplorer(['PMP-2003.SLDDRW'])
      store.setState({ detailsPanelVisible: true })
      store.getState().setDetailsPanelTab('orders')
      await sleep(900)
    },
    // Settings > Orders: prefix with the next number, default kinds, this computer.
    'orders-settings': async () => {
      await reset()
      await store.getState().loadOrders()
      store.getState().openSettings('orders')
      await until(() => document.body.textContent?.includes('Next order number'))
      await sleep(400)
    },
    // The Supplier Portal on quote orders (5.13.0: RFQs became quote orders).
    'orders-portal': async () => {
      await reset()
      // Two open quote orders beside the world's cancelled one: a draft, and one awaiting a quote.
      const quote = (title: string, supplier: keyof typeof LOOK_SUPPLIERS, file: string, version: number, send: boolean) => {
        const id = String((model.create({ p_title: title, p_purpose: 'quote', p_supplier_id: LOOK_SUPPLIERS[supplier].id, p_supplier_name: LOOK_SUPPLIERS[supplier].name }).order as Row).id)
        model.addLines({ p_order_id: id, p_lines: [{ file_version_id: lookReviewVersionId(file, version), output_kinds: ['step'], quantity: 500 }] })
        if (send) model.setStatus({ p_order_id: id, p_status: 'sent', p_allow_missing: true })
      }
      quote('Impeller, quote for 500', 'apex', 'PMP-2002.SLDPRT', 3, true)
      quote('Seal carrier, rev A quote', 'northline', 'PMP-2003.SLDPRT', 2, false)
      const state = store.getState()
      state.closeSettings()
      state.setActiveView('supplier-portal')
      store.setState({ sidebarWidth: 300, rightPanelVisible: false, detailsPanelVisible: false })
      await state.loadOrders()
      await sleep(600)
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
