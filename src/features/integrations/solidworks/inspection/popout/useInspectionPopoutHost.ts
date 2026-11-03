import { useEffect } from 'react'

import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'

import {
  POPOUT_TIMEOUT_MS,
  POPOUT_UI_KEYS,
  createPopoutChannel,
  followedDrawingPath,
  pickPopoutUi,
  type HostMessage,
  type PopoutMessage,
  type PopoutUi,
} from './inspectionPopout'

/**
 * Main-window side of the popped-out Inspection window (see `inspectionPopout.ts`): tracks
 * whether it is alive, sends it the followed drawing, user, organization and preferences when
 * they change, and applies the preferences it sends back. Mounted once, in the main App.
 */
export function useInspectionPopoutHost(): void {
  useEffect(() => {
    const channel = createPopoutChannel()
    if (!channel) return

    let lastSeen = 0
    let followedPath: string | null = null
    let sent: {
      file: LocalFile | null
      user: unknown
      organization: unknown
      ui: PopoutUi | null
    } = { file: null, user: null, organization: null, ui: null }
    let lookup: {
      files: readonly LocalFile[] | null
      selected: readonly string[] | null
      file: LocalFile | null
    } = { files: null, selected: null, file: null }

    const setOpen = (open: boolean) => {
      if (usePDMStore.getState().inspectionPopoutOpen !== open) {
        usePDMStore.getState().setInspectionPopoutOpen(open)
      }
    }

    const post = (message: HostMessage) => {
      try {
        channel.postMessage(message)
      } catch (error) {
        log.warn('[InspectionPopout]', 'Could not send to the popped-out window', {
          error: String(error),
        })
      }
    }

    const sendState = (force: boolean) => {
      if (!lastSeen) return
      const s = usePDMStore.getState()
      // The lookups walk `files`: only when it or the selection changed, not on every store write.
      if (force || lookup.files !== s.files || lookup.selected !== s.selectedFiles) {
        followedPath = followedDrawingPath(s.selectedFiles, s.files, followedPath)
        const found = followedPath ? (s.files.find((f) => f.path === followedPath) ?? null) : null
        lookup = { files: s.files, selected: s.selectedFiles, file: found }
      }
      const file = lookup.file
      const ui = pickPopoutUi(s)
      const same =
        !force &&
        sent.file === file &&
        sent.user === s.user &&
        sent.organization === s.organization &&
        sent.ui !== null &&
        Object.is(sent.ui.inspectionColumnPrefs, ui.inspectionColumnPrefs) &&
        sent.ui.inspectionShowFilters === ui.inspectionShowFilters &&
        sent.ui.inspectionAutoSync === ui.inspectionAutoSync &&
        Object.is(sent.ui.inspectionDrawingSync, ui.inspectionDrawingSync)
      if (same) return
      sent = { file, user: s.user, organization: s.organization, ui }
      post({ type: 'state', file, user: s.user, organization: s.organization, ui })
    }

    channel.onmessage = (event: MessageEvent<PopoutMessage>) => {
      const message = event.data
      if (!message || typeof message !== 'object') return
      switch (message.type) {
        case 'hello':
          lastSeen = Date.now()
          setOpen(true)
          sendState(true)
          break
        case 'alive':
          if (!lastSeen) {
            // A window that outlived a reload of this one: adopt it.
            lastSeen = Date.now()
            setOpen(true)
            sendState(true)
          }
          lastSeen = Date.now()
          break
        case 'bye':
          lastSeen = 0
          setOpen(false)
          break
        case 'patch': {
          // Only the Inspection preferences, whatever else the message carries.
          const patch: Partial<PopoutUi> = {}
          for (const key of POPOUT_UI_KEYS) {
            if (key in message.ui) Object.assign(patch, { [key]: message.ui[key] })
          }
          usePDMStore.setState(patch)
          break
        }
      }
    }

    const unsubscribe = usePDMStore.subscribe(() => sendState(false))

    const watchdog = setInterval(() => {
      if (lastSeen && Date.now() - lastSeen > POPOUT_TIMEOUT_MS) {
        log.info('[InspectionPopout]', 'Popped-out window stopped answering; taking the tab back')
        lastSeen = 0
        setOpen(false)
      }
    }, POPOUT_TIMEOUT_MS / 2)

    // Asking the window to close is how "Bring back" works.
    const closeRequest = () => post({ type: 'close' })
    window.addEventListener('blueplm:inspection-popout-close', closeRequest)

    return () => {
      unsubscribe()
      clearInterval(watchdog)
      window.removeEventListener('blueplm:inspection-popout-close', closeRequest)
      channel.close()
    }
  }, [])
}

/** Ask the popped-out Inspection window to close (the main window takes the tab back). */
export function requestInspectionPopoutClose(): void {
  window.dispatchEvent(new Event('blueplm:inspection-popout-close'))
  usePDMStore.getState().setInspectionPopoutOpen(false)
}
