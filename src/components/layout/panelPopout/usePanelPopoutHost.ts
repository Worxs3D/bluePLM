import { useEffect } from 'react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import type { DetailsPanelTab } from '@/stores/types'

import {
  NOTHING_FOLLOWED,
  POPOUT_TIMEOUT_MS,
  POPOUT_UI_KEYS,
  childRows,
  createPopoutChannel,
  findFileForNavigation,
  followSelection,
  isPopoutTab,
  pickPopoutUi,
  samePopoutState,
  type Followed,
  type HostMessage,
  type PopoutMessage,
  type PopoutState,
  type PopoutUi,
} from './panelPopout'

const CLOSE_EVENT = 'blueplm:panel-popout-close'

/** One popped-out window, as the main window tracks it. */
interface WindowRecord {
  lastSeen: number
  followed: Followed
  /** The inputs `followed` was computed from, so it is recomputed only when they change. */
  inputs: { files: unknown; selected: unknown; child: unknown } | null
  sent: PopoutState | null
}

/**
 * Main-window side of the popped-out tab windows (see `panelPopout.ts`): tracks which are alive,
 * sends each the file it follows, user, organization and preferences when they change, applies
 * the preferences they send back and selects the files they ask for. Mounted once, in the main
 * App.
 */
export function usePanelPopoutHost(): void {
  useEffect(() => {
    const channel = createPopoutChannel()
    if (!channel) return

    const windows = new Map<DetailsPanelTab, WindowRecord>()

    const setOpen = (tab: DetailsPanelTab, open: boolean) => {
      const state = usePDMStore.getState()
      if (state.poppedOutTabs.includes(tab) !== open) state.setTabPoppedOut(tab, open)
    }

    const post = (message: HostMessage) => {
      try {
        channel.postMessage(message)
      } catch (error) {
        log.warn('[PanelPopout]', 'Could not send to a popped-out window', {
          tab: message.tab,
          error: String(error),
        })
      }
    }

    const sendState = (tab: DetailsPanelTab, record: WindowRecord, force: boolean) => {
      const s = usePDMStore.getState()
      // The lookups walk `files`: only when it or the selection changed, not on every store write.
      const inputs = { files: s.files, selected: s.selectedFiles, child: s.childSelection }
      const stale =
        !record.inputs ||
        record.inputs.files !== inputs.files ||
        record.inputs.selected !== inputs.selected ||
        record.inputs.child !== inputs.child
      let file = record.sent?.file ?? null
      if (force || stale) {
        record.followed = followSelection(
          tab,
          s.selectedFiles,
          s.files,
          s.childSelection,
          record.followed,
        )
        record.inputs = inputs
        const path = record.followed.path
        file = path ? (s.files.find((f) => f.path === path) ?? null) : null
      }
      const child = file ? record.followed.child : null
      const next: PopoutState = {
        file,
        child,
        ...childRows(child, s.versionOutputs, s.drawingInspectionReports),
        user: s.user,
        organization: s.organization,
        ui: pickPopoutUi(s),
      }
      if (!force && record.sent && samePopoutState(record.sent, next)) return
      record.sent = next
      post({ type: 'state', tab, ...next })
    }

    const adopt = (tab: DetailsPanelTab) => {
      const record: WindowRecord = {
        lastSeen: Date.now(),
        followed: windows.get(tab)?.followed ?? NOTHING_FOLLOWED,
        inputs: null,
        sent: null,
      }
      windows.set(tab, record)
      setOpen(tab, true)
      sendState(tab, record, true)
    }

    const drop = (tab: DetailsPanelTab) => {
      windows.delete(tab)
      setOpen(tab, false)
    }

    channel.onmessage = (event: MessageEvent<PopoutMessage>) => {
      const message = event.data
      if (!message || typeof message !== 'object' || !isPopoutTab(message.tab)) return
      const tab = message.tab
      switch (message.type) {
        case 'hello':
          adopt(tab)
          break
        case 'alive': {
          const record = windows.get(tab)
          // A window that outlived a reload of this one: adopt it.
          if (record) record.lastSeen = Date.now()
          else adopt(tab)
          break
        }
        case 'bye':
          drop(tab)
          break
        case 'patch': {
          // Only the Inspection preferences, whatever else the message carries.
          if (!message.ui || typeof message.ui !== 'object') break
          const patch: Partial<PopoutUi> = {}
          for (const key of POPOUT_UI_KEYS) {
            if (key in message.ui) Object.assign(patch, { [key]: message.ui[key] })
          }
          usePDMStore.setState(patch)
          break
        }
        case 'navigate': {
          if (typeof message.path !== 'string') break
          const state = usePDMStore.getState()
          const target = findFileForNavigation(state.files, message.path)
          if (target) state.setSelectedFiles([target.path])
          else state.addToast('info', t('source.details.popoutFileNotInVault'))
          break
        }
      }
    }

    const unsubscribe = usePDMStore.subscribe(() => {
      for (const [tab, record] of windows) sendState(tab, record, false)
    })

    const watchdog = setInterval(() => {
      const now = Date.now()
      for (const [tab, record] of windows) {
        if (now - record.lastSeen > POPOUT_TIMEOUT_MS) {
          log.info('[PanelPopout]', 'Popped-out window stopped answering; taking the tab back', {
            tab,
          })
          drop(tab)
        }
      }
    }, POPOUT_TIMEOUT_MS / 2)

    // Asking the window to close is how "Bring back" works.
    const closeRequest = (event: Event) => {
      const tab = (event as CustomEvent<unknown>).detail
      if (isPopoutTab(tab)) post({ type: 'close', tab })
    }
    window.addEventListener(CLOSE_EVENT, closeRequest)

    return () => {
      unsubscribe()
      clearInterval(watchdog)
      window.removeEventListener(CLOSE_EVENT, closeRequest)
      channel.close()
    }
  }, [])
}

/** Ask a popped-out tab's window to close (the main window takes the tab back). */
export function requestPanelPopoutClose(tab: DetailsPanelTab): void {
  window.dispatchEvent(new CustomEvent(CLOSE_EVENT, { detail: tab }))
  usePDMStore.getState().setTabPoppedOut(tab, false)
}
