import { useEffect, useState } from 'react'
import { ClipboardList, Loader2 } from 'lucide-react'

import { Toast } from '@/components/core'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'

import { InspectionTab } from '../InspectionTab'
import {
  POPOUT_HEARTBEAT_MS,
  createPopoutChannel,
  diffPopoutUi,
  pickPopoutUi,
  type HostMessage,
  type PopoutMessage,
  type PopoutUi,
} from './inspectionPopout'

/**
 * The popped-out Inspection window's body (TabWindow with `customData.panel = 'inspection'`).
 * Everything it shows comes from the main window over the channel (see `inspectionPopout.ts`);
 * the Inspection preferences it changes go back the same way, since this window never writes the
 * persisted store.
 */
export function InspectionPopoutWindow() {
  const [file, setFile] = useState<LocalFile | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const channel = createPopoutChannel()
    if (!channel) {
      log.warn('[InspectionPopout]', 'BroadcastChannel is not available in this window')
      return
    }
    // The preferences as the main window last sent them; local changes are diffed against it.
    let fromHost: PopoutUi | null = null

    const post = (message: PopoutMessage) => {
      try {
        channel.postMessage(message)
      } catch (error) {
        log.warn('[InspectionPopout]', 'Could not reach the main window', { error: String(error) })
      }
    }

    channel.onmessage = (event: MessageEvent<HostMessage>) => {
      const message = event.data
      if (!message || typeof message !== 'object') return
      if (message.type === 'close') {
        window.close()
        return
      }
      if (message.type !== 'state') return
      fromHost = message.ui
      usePDMStore.setState({
        user: message.user,
        organization: message.organization,
        ...message.ui,
      })
      setFile(message.file)
      setConnected(true)
    }

    const unsubscribe = usePDMStore.subscribe((state) => {
      if (!fromHost) return
      const next = pickPopoutUi(state)
      const patch = diffPopoutUi(fromHost, next)
      if (Object.keys(patch).length === 0) return
      fromHost = next
      post({ type: 'patch', ui: patch })
    })

    post({ type: 'hello' })
    const heartbeat = setInterval(() => post({ type: 'alive' }), POPOUT_HEARTBEAT_MS)
    const onUnload = () => post({ type: 'bye' })
    window.addEventListener('beforeunload', onUnload)

    return () => {
      onUnload()
      unsubscribe()
      clearInterval(heartbeat)
      window.removeEventListener('beforeunload', onUnload)
      channel.close()
    }
  }, [])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {!connected ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-sm text-plm-fg-muted">
          <Loader2 size={16} className="animate-spin" />
          {t('source.inspection.popoutWaiting')}
        </div>
      ) : !file ? (
        <div className="flex-1 flex flex-col items-center justify-center text-sm text-plm-fg-muted p-6 text-center">
          <ClipboardList size={28} className="mb-2 opacity-60" />
          {t('source.inspection.popoutSelectDrawing')}
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <InspectionTab file={file} />
        </div>
      )}
      <Toast />
    </div>
  )
}
