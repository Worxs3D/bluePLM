import { t } from '@/lib/i18n'
import type { DetailsPanelTab, LocalFile, UISlice } from '@/stores/types'
import type { InspectionReport } from '@/types/inspectionReports'
import type { Organization, User } from '@/types/pdm'
import type { VersionOutput } from '@/types/versionOutputs'
import {
  activeChildSelection,
  type ChildPreviewTarget,
  type ChildSelection,
} from '@/features/source/outputs/preview/childPreviewModel'

/**
 * A details tab (Preview, Properties, Where Used, Vendors, Inspection) popped out into its own
 * window: right-click the tab in the right or bottom panel.
 *
 * The window is the renderer's `TabWindow` (`?mode=tab`, `customData.panel = <tab>`), opened by
 * the main process (`app:open-tab-window`), one per tab. It is a separate renderer with its own
 * store that loads no vault and never writes the persisted store (`pdmStore.ts`), so the main
 * window drives it over a BroadcastChannel: it sends the file the tab follows (the single
 * selection, kept when the selection moves to nothing or to several files; for Inspection only a
 * drawing), the output or report row selected under it (Preview), the signed-in user and
 * organization, and the Inspection preferences. The window sends back the preferences it
 * changed and the files it asks to select (Where Used). While a window is alive the tab shows a
 * placeholder in the main window, so each tab is live in one place at a time (two Inspection
 * tables would race each other's autosaves and Auto runs).
 */

export const PANEL_POPOUT_CHANNEL = 'blueplm:panel-popout'

/** The tabs that can be popped out (the data card is not a details tab any more). */
export const POPOUT_TABS: readonly DetailsPanelTab[] = [
  'preview',
  'properties',
  'whereused',
  'vendors',
  'orders',
  'inspection',
]

/** The popped-out window says it is alive this often. */
export const POPOUT_HEARTBEAT_MS = 3000
/** Silence after which the main window takes the tab back (crashed window). */
export const POPOUT_TIMEOUT_MS = 10000

export type PopoutUi = Pick<
  UISlice,
  'inspectionColumnPrefs' | 'inspectionShowFilters' | 'inspectionAutoSync' | 'inspectionDrawingSync'
>

export const POPOUT_UI_KEYS: ReadonlyArray<keyof PopoutUi> = [
  'inspectionColumnPrefs',
  'inspectionShowFilters',
  'inspectionAutoSync',
  'inspectionDrawingSync',
]

/** What a popped-out tab shows. */
export interface PopoutState {
  file: LocalFile | null
  /** The output or report row selected under `file` (Preview only). */
  child: ChildPreviewTarget | null
  /** The live rows behind `child`: the outputs of its version, or the reports of its drawing. */
  outputs: readonly VersionOutput[]
  reports: readonly InspectionReport[]
  user: User | null
  organization: Organization | null
  ui: PopoutUi
}

/** Main window to popped-out window. */
export type HostMessage =
  | ({ type: 'state'; tab: DetailsPanelTab } & PopoutState)
  | { type: 'close'; tab: DetailsPanelTab }

/** Popped-out window to main window. */
export type PopoutMessage =
  | { type: 'hello' | 'alive' | 'bye'; tab: DetailsPanelTab }
  | { type: 'patch'; tab: DetailsPanelTab; ui: Partial<PopoutUi> }
  | { type: 'navigate'; tab: DetailsPanelTab; path: string }

export function isPopoutTab(value: unknown): value is DetailsPanelTab {
  return typeof value === 'string' && (POPOUT_TABS as readonly string[]).includes(value)
}

/** The tab a `TabWindow`'s `customData` pops out, or null for any other window. */
export function popoutTabOf(
  customData: Record<string, unknown> | undefined,
): DetailsPanelTab | null {
  const panel = customData?.panel
  return isPopoutTab(panel) ? panel : null
}

const TAB_LABEL_KEYS: Record<DetailsPanelTab, string> = {
  preview: 'source.details.popoutTabPreview',
  properties: 'source.details.popoutTabProperties',
  whereused: 'source.details.popoutTabWhereUsed',
  datacard: 'source.details.popoutTabDataCard',
  vendors: 'source.details.popoutTabVendors',
  orders: 'source.details.popoutTabOrders',
  inspection: 'source.details.popoutTabInspection',
}

export function popoutTabLabel(tab: DetailsPanelTab): string {
  return t(TAB_LABEL_KEYS[tab])
}

export function pickPopoutUi(state: PopoutUi): PopoutUi {
  return {
    inspectionColumnPrefs: state.inspectionColumnPrefs,
    inspectionShowFilters: state.inspectionShowFilters,
    inspectionAutoSync: state.inspectionAutoSync,
    inspectionDrawingSync: state.inspectionDrawingSync,
  }
}

/** The keys of `next` that are not the same reference as in `prev`. */
export function diffPopoutUi(prev: PopoutUi, next: PopoutUi): Partial<PopoutUi> {
  const patch: Partial<PopoutUi> = {}
  let changed = false
  for (const key of POPOUT_UI_KEYS) {
    if (!Object.is(prev[key], next[key])) {
      Object.assign(patch, { [key]: next[key] })
      changed = true
    }
  }
  return changed ? patch : {}
}

const isDrawing = (file: LocalFile) =>
  !file.isDirectory && (file.extension ?? '').toLowerCase() === '.slddrw'

/** What a popped-out tab follows: a file path and, for Preview, the child row selected under it. */
export interface Followed {
  path: string | null
  child: ChildPreviewTarget | null
}

export const NOTHING_FOLLOWED: Followed = { path: null, child: null }

/**
 * What the tab follows: the single selected file (Inspection: only a drawing), with the child row
 * selected under it for Preview; else what it followed before (still looked up in `files`, so the
 * file's changes keep flowing).
 */
export function followSelection(
  tab: DetailsPanelTab,
  selectedFiles: readonly string[],
  files: readonly LocalFile[],
  childSelection: ChildSelection | null,
  previous: Followed,
): Followed {
  if (selectedFiles.length !== 1) return previous
  const selected = files.find((f) => f.path === selectedFiles[0])
  if (!selected || (tab === 'inspection' && !isDrawing(selected))) return previous
  const child = tab === 'preview' ? activeChildSelection(childSelection, selectedFiles) : null
  if (previous.path === selected.path && previous.child === child) return previous
  return { path: selected.path, child }
}

const EMPTY_OUTPUTS: readonly VersionOutput[] = []
const EMPTY_REPORTS: readonly InspectionReport[] = []

/** The live rows the window needs to keep a followed child row up to date. */
export function childRows(
  child: ChildPreviewTarget | null,
  versionOutputs: ReadonlyMap<string, readonly VersionOutput[]>,
  reportsByFile: ReadonlyMap<string, readonly InspectionReport[]>,
): { outputs: readonly VersionOutput[]; reports: readonly InspectionReport[] } {
  if (child?.kind === 'output') {
    return {
      outputs: versionOutputs.get(child.output.fileVersionId) ?? EMPTY_OUTPUTS,
      reports: EMPTY_REPORTS,
    }
  }
  if (child?.kind === 'report') {
    return { outputs: EMPTY_OUTPUTS, reports: reportsByFile.get(child.fileId) ?? EMPTY_REPORTS }
  }
  return { outputs: EMPTY_OUTPUTS, reports: EMPTY_REPORTS }
}

/** Whether two states would show the same thing (references: the store replaces what changes). */
export function samePopoutState(a: PopoutState, b: PopoutState): boolean {
  return (
    a.file === b.file &&
    a.child === b.child &&
    a.outputs === b.outputs &&
    a.reports === b.reports &&
    a.user === b.user &&
    a.organization === b.organization &&
    Object.keys(diffPopoutUi(a.ui, b.ui)).length === 0
  )
}

/**
 * The popped-out window's own store, built from a state message: only the one file, selected,
 * with its child row and the rows behind it, so the tab components read it as they do in the
 * main window.
 */
export function popoutStorePatch(state: PopoutState) {
  const selectedFiles = state.file ? [state.file.path] : []
  const child = state.child
  return {
    user: state.user,
    organization: state.organization,
    ...state.ui,
    files: state.file ? [state.file] : [],
    selectedFiles,
    childSelection: child ? { target: child, anchor: selectedFiles } : null,
    versionOutputs:
      child?.kind === 'output'
        ? new Map([[child.output.fileVersionId, [...state.outputs]]])
        : new Map<string, VersionOutput[]>(),
    drawingInspectionReports:
      child?.kind === 'report'
        ? new Map([[child.fileId, [...state.reports]]])
        : new Map<string, InspectionReport[]>(),
  }
}

/**
 * The file a Where Used row names, as the main window's selection holds it (full path). The
 * row's path may be the full path or the vault-relative one, in any case.
 */
export function findFileForNavigation(files: readonly LocalFile[], path: string): LocalFile | null {
  const wanted = path.toLowerCase()
  return (
    files.find((f) => f.path.toLowerCase() === wanted || f.relativePath.toLowerCase() === wanted) ??
    null
  )
}

const WINDOW_SIZE: Partial<Record<DetailsPanelTab, { width: number; height: number }>> = {
  inspection: { width: 1100, height: 720 },
  preview: { width: 960, height: 760 },
}

/** Open (or focus) the tab's window. False where there is no desktop bridge. */
export async function openPanelPopout(tab: DetailsPanelTab): Promise<boolean> {
  const open = window.electronAPI?.openTabWindow
  if (!open) return false
  const size = WINDOW_SIZE[tab] ?? { width: 720, height: 640 }
  const result = await open({
    // One window per tab; the Inspection window keeps the key it had before every tab could.
    key: tab,
    view: 'explorer',
    title: popoutTabLabel(tab),
    customData: { panel: tab },
    ...size,
  })
  return result.success
}

/** Only the desktop can open another window (the main process creates it). */
export function canPopOutTabs(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.openTabWindow
}

export function createPopoutChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(PANEL_POPOUT_CHANNEL)
  } catch {
    return null
  }
}
