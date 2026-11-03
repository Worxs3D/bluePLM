import { useEffect, useRef, useState } from 'react'
import { ClipboardList, File, Loader2 } from 'lucide-react'

import { Toast } from '@/components/core'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import type { DetailsPanelTab } from '@/stores/types'

import { RightPanelTabContent } from '../RightPanel/RightPanelTabContent'
import {
  POPOUT_HEARTBEAT_MS,
  createPopoutChannel,
  diffPopoutUi,
  pickPopoutUi,
  popoutStorePatch,
  type HostMessage,
  type PopoutMessage,
  type PopoutState,
  type PopoutUi,
} from './panelPopout'

/**
 * A popped-out tab window's body (TabWindow with `customData.panel = <tab>`). Everything it shows
 * comes from the main window over the channel (see `panelPopout.ts`); the Inspection preferences
 * it changes and the files it asks to select go back the same way, since this window has no
 * vault and never writes the persisted store.
 */
export function PanelPopoutWindow({ tab }: { tab: DetailsPanelTab }) {
  const [state, setState] = useState<PopoutState | null>(null)
  const postRef = useRef<(message: PopoutMessage) => void>(() => {})

  useEffect(() => {
    const channel = createPopoutChannel()
    if (!channel) {
      log.warn('[PanelPopout]', 'BroadcastChannel is not available in this window')
      return
    }
    // The preferences as the main window last sent them; local changes are diffed against it.
    let fromHost: PopoutUi | null = null

    const post = (message: PopoutMessage) => {
      try {
        channel.postMessage(message)
      } catch (error) {
        log.warn('[PanelPopout]', 'Could not reach the main window', { error: String(error) })
      }
    }
    postRef.current = post

    channel.onmessage = (event: MessageEvent<HostMessage>) => {
      const message = event.data
      if (!message || typeof message !== 'object' || message.tab !== tab) return
      if (message.type === 'close') {
        window.close()
        return
      }
      if (message.type !== 'state') return
      fromHost = message.ui
      usePDMStore.setState(popoutStorePatch(message))
      setState(message)
    }

    const unsubscribe = usePDMStore.subscribe((s) => {
      if (!fromHost) return
      const next = pickPopoutUi(s)
      const patch = diffPopoutUi(fromHost, next)
      if (Object.keys(patch).length === 0) return
      fromHost = next
      post({ type: 'patch', tab, ui: patch })
    })

    post({ type: 'hello', tab })
    const heartbeat = setInterval(() => post({ type: 'alive', tab }), POPOUT_HEARTBEAT_MS)
    const onUnload = () => post({ type: 'bye', tab })
    window.addEventListener('beforeunload', onUnload)

    return () => {
      onUnload()
      unsubscribe()
      clearInterval(heartbeat)
      window.removeEventListener('beforeunload', onUnload)
      postRef.current = () => {}
      channel.close()
    }
  }, [tab])

  const file = state?.file ?? null
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {!state ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-sm text-plm-fg-muted">
          <Loader2 size={16} className="animate-spin" />
          {t('source.details.popoutWaiting')}
        </div>
      ) : !file ? (
        <div className="flex-1 flex flex-col items-center justify-center text-sm text-plm-fg-muted p-6 text-center">
          {tab === 'inspection' ? (
            <ClipboardList size={28} className="mb-2 opacity-60" />
          ) : (
            <File size={28} className="mb-2 opacity-60" />
          )}
          {tab === 'inspection'
            ? t('source.inspection.popoutSelectDrawing')
            : t('source.details.popoutSelectFile')}
        </div>
      ) : (
        <div
          className={tab === 'inspection' ? 'flex-1 overflow-hidden' : 'flex-1 overflow-auto p-4'}
        >
          <RightPanelTabContent
            tab={tab}
            file={file}
            childTarget={state.child}
            onNavigate={(path) => postRef.current({ type: 'navigate', tab, path })}
          />
        </div>
      )}
      <Toast />
    </div>
  )
}
