import type { LocalFile, UISlice } from '@/stores/types'
import type { Organization, User } from '@/types/pdm'

/**
 * The Inspection tab popped out into its own window (right-click the tab in the right panel).
 *
 * The window is the renderer's `TabWindow` (`?mode=tab`), opened by the main process
 * (`app:open-tab-window`). It is a separate renderer with its own store that loads no vault and
 * never writes the persisted store (`pdmStore.ts`), so the main window drives it over a
 * BroadcastChannel: it sends the drawing it follows (the single selected `.slddrw`, kept when the
 * selection moves to something else), the signed-in user and organization, and the Inspection
 * preferences; the popped-out window sends back the preferences it changed. While the window is
 * alive the main window's Inspection tab shows a placeholder, so one table is live at a time
 * (two would race each other's autosaves and Auto runs).
 */

export const INSPECTION_POPOUT_CHANNEL = 'blueplm:inspection-popout'
export const INSPECTION_POPOUT_KEY = 'inspection'
/** `customData.panel` of the popped-out window. */
export const INSPECTION_POPOUT_PANEL = 'inspection'

/** The popped-out window says it is alive this often. */
export const POPOUT_HEARTBEAT_MS = 3000
/** Silence after which the main window takes the Inspection tab back (crashed window). */
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

/** Main window to popped-out window. */
export type HostMessage =
  | {
      type: 'state'
      file: LocalFile | null
      user: User | null
      organization: Organization | null
      ui: PopoutUi
    }
  | { type: 'close' }

/** Popped-out window to main window. */
export type PopoutMessage =
  | { type: 'hello' }
  | { type: 'alive' }
  | { type: 'bye' }
  | { type: 'patch'; ui: Partial<PopoutUi> }

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

const isDrawing = (file: LocalFile) => (file.extension ?? '').toLowerCase() === '.slddrw'

/**
 * The drawing the popped-out window follows: the single selected drawing, else the one it
 * followed before (still looked up in `files`, so its changes on disk keep flowing).
 */
export function followedDrawingPath(
  selectedFiles: readonly string[],
  files: readonly LocalFile[],
  previous: string | null,
): string | null {
  if (selectedFiles.length === 1) {
    const selected = files.find((f) => f.path === selectedFiles[0])
    if (selected && !selected.isDirectory && isDrawing(selected)) return selected.path
  }
  return previous
}

export function isInspectionPopoutData(customData: Record<string, unknown> | undefined): boolean {
  return customData?.panel === INSPECTION_POPOUT_PANEL
}

/** Open (or focus) the popped-out Inspection window. False where there is no desktop bridge. */
export async function openInspectionPopout(title: string): Promise<boolean> {
  const open = window.electronAPI?.openTabWindow
  if (!open) return false
  const result = await open({
    key: INSPECTION_POPOUT_KEY,
    view: 'explorer',
    title,
    customData: { panel: INSPECTION_POPOUT_PANEL },
    width: 1100,
    height: 720,
  })
  return result.success
}

export function createPopoutChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(INSPECTION_POPOUT_CHANNEL)
  } catch {
    return null
  }
}
