/**
 * `window.__blueplmLook`: what `scripts/ui-look` drives inside a ui-look boot (perf build,
 * `?look=1`). It puts the app into a named scene through the store actions the UI itself calls,
 * and the runner screenshots the result. Never part of a release build.
 */
import type { usePDMStore } from '@/stores/pdmStore'
import type { DrawingRefItem } from '@/stores/types'
import type { Json } from '@/types/supabase'
import type { VersionOutput, VersionOutputKind } from '@/types/versionOutputs'

import type { PerfBackend } from './backend'
import { lookVaultAuditReport } from './lookFixtures'
import {
  LOOK_DRAWING,
  LOOK_EMPTY_DRAWING,
  LOOK_FILE_IDS,
  LOOK_INSPECTION_FOLDER,
  LOOK_READONLY_DRAWING,
  LOOK_TEMPLATE_IDS,
  lookVersionId,
} from './lookInspectionFixtures'
import type { SeededContent } from './lookPreviewFixtures'

type Store = typeof usePDMStore

/** The look report the preview scene shows (production, returned, with results). */
const LOOK_PREVIEW_REPORT_ID = '00000000-0000-4000-8000-1e9070000003'

export interface LookControl {
  /** Scene names `scene()` accepts. */
  scenes(): string[]
  /** Put the app into a scene. Throws on an unknown name. */
  scene(name: string): Promise<void>
  /** The store, for one-off setup from a runner `--eval`. */
  store: Store
}

declare global {
  interface Window {
    __blueplmLook?: LookControl
  }
}

function openVaultAudit(store: Store): void {
  store.setState({ vaultAuditOpenRequested: true })
  store.getState().openSettings('solidworks')
}

function auditRunBase(store: Store) {
  const state = store.getState()
  return {
    id: `look-run-${Date.now()}`,
    startedAt: Date.now() - 163_000,
    scope: state.vaultAuditScope,
    artifactPath: null,
    error: null,
    cancelRequested: false,
  }
}

/** Local path of a look inspection file. */
function lookPath(store: Store, name: string): string {
  const root = store.getState().vaultPath ?? ''
  return [root, ...LOOK_INSPECTION_FOLDER.split('/'), name].join('\\')
}

/** Leave settings and open the inspection folder in the file list. */
function openInspectionFolder(store: Store): void {
  const state = store.getState()
  state.closeSettings()
  // A working width for the tree, so the file list and panels get the room a user would give them.
  store.setState({ activeView: 'explorer', sidebarWidth: 260 })
  state.setCurrentFolder(LOOK_INSPECTION_FOLDER)
}

/** Select a drawing and show its Inspection tab in the details panel (bottom). */
function showInspectionTab(store: Store, name: string, reports: boolean): void {
  openInspectionFolder(store)
  const state = store.getState()
  state.setSelectedFiles([lookPath(store, name)])
  store.setState({ detailsPanelVisible: true, detailsPanelHeight: 560, rightPanelVisible: false })
  state.setDetailsPanelTab('inspection')
  if (reports) state.focusInspectionReports(LOOK_FILE_IDS[name], null)
}

function refItem(store: Store, name: string, type: DrawingRefItem['file_type'], partNumber: string, description: string): DrawingRefItem {
  return {
    id: LOOK_FILE_IDS[name],
    file_id: LOOK_FILE_IDS[name],
    file_name: name,
    file_path: lookPath(store, name),
    file_type: type,
    part_number: partNumber,
    description,
    revision: 'B',
    state: 'In Work',
    configuration: 'Default',
    configurationConfirmed: true,
    configurations: ['Default'],
    in_database: true,
  }
}

/** Template rows get the layout the real analysis gives each built-in (async: exceljs loads lazily). */
async function analyzeLookTemplates(backend: PerfBackend): Promise<void> {
  const { analyzeTemplate, builtInTemplates } = await import('@/lib/inspection/excel')
  const builtIns = await builtInTemplates()
  const rows = backend.db.rows('inspection_template' as never)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const pairs: Array<[string, number]> = [
    [LOOK_TEMPLATE_IDS.dimensional, 0],
    [LOOK_TEMPLATE_IDS.fai, 1],
  ]
  for (const [id, index] of pairs) {
    const row = byId.get(id)
    if (row) row.layout = JSON.parse(JSON.stringify(await analyzeTemplate(builtIns[index].bytes))) as Json
  }
}

/**
 * The file list with every kind of child row: a drawing's referenced part, its PDF and its
 * reports; a second drawing with its PDF being generated; a part's configurations and STEP; an
 * assembly whose STEP failed. `content` gives the PDF and STEP real stored bytes (preview scenes).
 */
function showFileList(store: Store, content?: Partial<Record<VersionOutputKind, SeededContent>>): void {
  openInspectionFolder(store)
  const drawingPath = lookPath(store, LOOK_DRAWING)
  const spacerDrawing = lookPath(store, LOOK_EMPTY_DRAWING)
  const part = lookPath(store, 'BR-103849-201.SLDPRT')
  const assembly = lookPath(store, 'BR-103849-100.SLDASM')
  const state = store.getState()
  state.setDrawingRefData(drawingPath, [
    refItem(store, 'BR-103849-201.SLDPRT', 'part', 'BR-103849-201', 'Bracket, motor mount, 6061-T6'),
  ])
  state.setDrawingRefData(spacerDrawing, [
    refItem(store, 'BR-103849-202.SLDPRT', 'part', 'BR-103849-202', 'Spacer, motor mount, Delrin'),
  ])
  state.setFileConfigurations(part, [
    { name: 'Default', isActive: true, depth: 0, description: 'Bracket, motor mount, 6061-T6' },
    { name: 'Anodized', depth: 1, description: 'Bracket, motor mount, anodized black' },
  ])
  state.setFileConfigurations(assembly, [{ name: 'Default', isActive: true, depth: 0 }])
  const now = Date.now()
  // The outputs the loader would read (the fake cannot answer its nested or(and(...)) filter).
  const versionOf = (name: string, n: number) => ({ version: n, fileVersionId: lookVersionId(name, n) })
  const latest: Array<[string, number]> = [
    [LOOK_DRAWING, 3],
    [LOOK_EMPTY_DRAWING, 1],
    ['BR-103849-201.SLDPRT', 6],
    ['BR-103849-100.SLDASM', 4],
  ]
  state.setFileOutputVersions(new Map(latest.map(([name, n]) => [LOOK_FILE_IDS[name], versionOf(name, n)])))
  const output = (name: string, n: number, kind: VersionOutputKind, size: number, fileName: string | null) => ({
    id: `look-output-${name}-${kind}`,
    kind,
    fileId: LOOK_FILE_IDS[name],
    fileVersionId: lookVersionId(name, n),
    configuration: null,
    storageHash: content?.[kind]?.hash ?? 'f'.repeat(64),
    fileSize: content?.[kind]?.size ?? size,
    fileName,
    closureExact: true,
    generatedBy: null,
    generatedAt: new Date(now - 4 * 86_400_000).toISOString(),
  })
  state.setVersionOutputs(
    new Map<string, VersionOutput[]>([
      [lookVersionId(LOOK_DRAWING, 3), [output(LOOK_DRAWING, 3, 'pdf', 1_303_000, null)]],
      [lookVersionId(LOOK_EMPTY_DRAWING, 1), []],
      [
        lookVersionId('BR-103849-201.SLDPRT', 6),
        [output('BR-103849-201.SLDPRT', 6, 'step', 2_830_000, 'BR-103849-201_RevB.step')],
      ],
      [lookVersionId('BR-103849-100.SLDASM', 4), []],
    ]),
  )
  // The rows and the Outputs column show each file's newest output per kind, with its version.
  state.setFileOutputHeads(
    new Map([
      [LOOK_FILE_IDS[LOOK_DRAWING], [{ ...output(LOOK_DRAWING, 3, 'pdf', 1_303_000, null), version: 3 }]],
      [LOOK_FILE_IDS[LOOK_EMPTY_DRAWING], []],
      [
        LOOK_FILE_IDS['BR-103849-201.SLDPRT'],
        [{ ...output('BR-103849-201.SLDPRT', 6, 'step', 2_830_000, 'BR-103849-201_RevB.step'), version: 6 }],
      ],
      [LOOK_FILE_IDS['BR-103849-100.SLDASM'], []],
    ]),
  )
  state.upsertOutputJob({
    key: `${LOOK_FILE_IDS[LOOK_EMPTY_DRAWING]}:pdf:`,
    fileId: LOOK_FILE_IDS[LOOK_EMPTY_DRAWING],
    fileVersionId: lookVersionId(LOOK_EMPTY_DRAWING, 1),
    kind: 'pdf',
    configuration: null,
    fileName: LOOK_EMPTY_DRAWING,
    status: 'running',
    detail: null,
    auto: true,
    updatedAt: now,
  })
  state.upsertOutputJob({
    key: `${LOOK_FILE_IDS['BR-103849-100.SLDASM']}:step:`,
    fileId: LOOK_FILE_IDS['BR-103849-100.SLDASM'],
    fileVersionId: lookVersionId('BR-103849-100.SLDASM', 4),
    kind: 'step',
    configuration: null,
    fileName: 'BR-103849-100.SLDASM',
    status: 'failed',
    detail: 'SW_SERVICE_OFFLINE',
    auto: true,
    updatedAt: now,
  })
  store.setState({
    expandedDrawingRefs: new Set([drawingPath, spacerDrawing]),
    expandedConfigFiles: new Set([part, assembly]),
    detailsPanelVisible: false,
    rightPanelVisible: false,
  })
  state.setSelectedFiles([drawingPath])
}

async function until(check: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('look: timed out waiting for the scene data')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/**
 * The file list with one child row selected and previewed in the bottom panel: the drawing's
 * inspection report (a real workbook from the engine), its PDF (two sheets) or the part's STEP.
 * The content is stored in the fake bucket under its real hash, so the preview downloads and
 * verifies it as in the app.
 */
async function showOutputPreview(store: Store, backend: PerfBackend, which: 'report' | 'pdf' | 'step'): Promise<void> {
  const fixtures = await import('./lookPreviewFixtures')
  const orgId = store.getState().organization?.id ?? ''
  const content: Partial<Record<VersionOutputKind, SeededContent>> = {}
  if (which === 'pdf') content.pdf = await fixtures.seedContent(backend, orgId, fixtures.samplePdf())
  if (which === 'step') content.step = await fixtures.seedContent(backend, orgId, fixtures.sampleStep())
  // The outputs loader re-reads these rows, so they carry the real content too.
  const pointRows = (table: string, fileVersionId: string, seeded: SeededContent | undefined) => {
    if (!seeded) return
    for (const row of backend.db.rows(table as never) as unknown as Array<Record<string, unknown>>) {
      if (row.file_version_id !== fileVersionId) continue
      row.storage_hash = seeded.hash
      row.file_size = seeded.size
    }
  }
  pointRows('drawing_pdf_render', lookVersionId(LOOK_DRAWING, 3), content.pdf)
  pointRows('file_version_output', lookVersionId('BR-103849-201.SLDPRT', 6), content.step)
  if (which === 'report') {
    const workbook = await fixtures.seedContent(backend, orgId, await fixtures.sampleReportWorkbook())
    const row = backend.db.row('inspection_report' as never, LOOK_PREVIEW_REPORT_ID) as unknown as Record<string, unknown>
    row.storage_hash = workbook.hash
    row.returned_hash = workbook.hash
    row.file_size = workbook.size
  }
  showFileList(store, content)
  store.setState({ detailsPanelVisible: true, detailsPanelHeight: 540 })
  const { selectChildRow } = await import('@/features/source/outputs/preview/selectChildRow')
  const drawingId = LOOK_FILE_IDS[LOOK_DRAWING]
  if (which === 'report') {
    await until(() => !!store.getState().drawingInspectionReports.get(drawingId)?.some((r) => r.id === LOOK_PREVIEW_REPORT_ID))
    const report = store.getState().drawingInspectionReports.get(drawingId)!.find((r) => r.id === LOOK_PREVIEW_REPORT_ID)!
    const version = store.getState().reportVersionNumbers.get(report.fileVersionId) ?? 3
    selectChildRow({ kind: 'report', filePath: lookPath(store, LOOK_DRAWING), fileId: drawingId, version, report })
    return
  }
  const name = which === 'pdf' ? LOOK_DRAWING : 'BR-103849-201.SLDPRT'
  const version = which === 'pdf' ? 3 : 6
  const output = store.getState().versionOutputs.get(lookVersionId(name, version))?.[0]
  if (!output) throw new Error(`look: no ${which} output`)
  selectChildRow({ kind: 'output', filePath: lookPath(store, name), fileId: LOOK_FILE_IDS[name], version, output })
}

export function installLook(store: Store, backend: PerfBackend): void {
  const scenes: Record<string, () => void | Promise<void>> = {
    // Inspection: the table of a ballooned drawing checked out by me (editable).
    'inspection-table': () => showInspectionTab(store, LOOK_DRAWING, false),
    // The same table with the right panel instead of the bottom panel (narrow layout).
    'inspection-table-right': () => {
      showInspectionTab(store, LOOK_DRAWING, false)
      store.setState({
        detailsPanelVisible: false,
        rightPanelVisible: true,
        rightPanelWidth: 620,
        rightPanelTab: 'inspection',
        rightPanelTabs: [...new Set([...store.getState().rightPanelTabs, 'inspection' as const])],
      })
    },
    // A drawing checked out by someone else: read-only table.
    'inspection-table-readonly': () => showInspectionTab(store, LOOK_READONLY_DRAWING, false),
    // A drawing with no characteristics yet (empty state).
    'inspection-table-empty': () => showInspectionTab(store, LOOK_EMPTY_DRAWING, false),
    // Reports of the ballooned drawing: five reports in every status across versions 2 and 3.
    'inspection-reports': async () => {
      await analyzeLookTemplates(backend)
      showInspectionTab(store, LOOK_DRAWING, true)
    },
    // "Generate with options..." on the ballooned drawing: the default (production, its revision
    // has had its FAI), then each other type.
    ...Object.fromEntries(
      ([
        ['inspection-generate-options', null],
        ['inspection-generate-options-fai', 'fai'],
        ['inspection-generate-options-receiving', 'receiving'],
        ['inspection-generate-options-reinspection', 'reinspection'],
      ] as const).map(([name, type]) => [
        name,
        async () => {
          await analyzeLookTemplates(backend)
          showInspectionTab(store, LOOK_DRAWING, true)
          const { requestGenerateOptions } = await import(
            '@/features/integrations/solidworks/inspection/reports/reportCommands'
          )
          // After the Reports view has mounted and listens.
          await new Promise((resolve) => setTimeout(resolve, 600))
          requestGenerateOptions(LOOK_FILE_IDS[LOOK_DRAWING], type)
        },
      ]),
    ),
    // Reports of a drawing with none (empty state).
    'inspection-reports-empty': async () => {
      await analyzeLookTemplates(backend)
      showInspectionTab(store, LOOK_EMPTY_DRAWING, true)
    },
    'inspection-file-list': () => showFileList(store),
    // The same list with a child row selected and shown in the bottom panel's Preview tab.
    'inspection-file-list-report': () => showOutputPreview(store, backend, 'report'),
    'inspection-file-list-pdf': () => showOutputPreview(store, backend, 'pdf'),
    'inspection-file-list-step': () => showOutputPreview(store, backend, 'step'),
    // Settings > Organization > Inspection templates (with Report naming).
    'settings-inspection-templates': async () => {
      await analyzeLookTemplates(backend)
      store.getState().openSettings('inspection-templates')
    },
    // Settings > Export.
    'settings-export': () => store.getState().openSettings('export'),
    'vault-audit-scope': () => {
      store.getState().clearVaultAuditRun()
      openVaultAudit(store)
    },
    'vault-audit-folder': () => {
      store.getState().clearVaultAuditRun()
      store.getState().setVaultAuditScope({ kind: 'folder', folderPath: '' })
      openVaultAudit(store)
    },
    'vault-audit-running': () => {
      store.setState({
        vaultAuditRun: {
          ...auditRunBase(store),
          startedAt: Date.now() - 74_000,
          state: 'running',
          progress: { completed: 182, total: 412, message: '' },
          report: null,
        },
      })
      openVaultAudit(store)
    },
    'vault-audit-results': () => {
      const vaultPath = store.getState().vaultPath ?? 'C:\\Vault'
      store.setState({
        vaultAuditRun: {
          ...auditRunBase(store),
          state: 'complete',
          progress: { completed: 412, total: 412, message: '' },
          report: lookVaultAuditReport(vaultPath),
        },
      })
      openVaultAudit(store)
    },
  }

  window.__blueplmLook = {
    scenes: () => Object.keys(scenes),
    store,
    async scene(name) {
      const set = scenes[name]
      if (!set) throw new Error(`unknown scene "${name}"; scenes: ${Object.keys(scenes).join(', ')}`)
      await set()
      // Two frames, so the scene is committed and painted before the runner screenshots it.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    },
  }
}
