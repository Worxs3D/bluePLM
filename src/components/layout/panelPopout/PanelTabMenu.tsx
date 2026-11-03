import { useEffect, useRef } from 'react'
import { ExternalLink } from 'lucide-react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import type { DetailsPanelTab } from '@/stores/types'

import { openPanelPopout, popoutTabLabel } from './panelPopout'
import { requestPanelPopoutClose } from './usePanelPopoutHost'

interface PanelTabMenuProps {
  tab: DetailsPanelTab
  /** The tab is already in its own window: offer to bring it back as well. */
  poppedOut: boolean
  position: { x: number; y: number }
  onClose: () => void
}

/** Context menu of a details tab header (right or bottom panel): pop the tab out. */
export function PanelTabMenu({ tab, poppedOut, position, onClose }: PanelTabMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const itemClass = 'w-full flex items-center gap-2 px-3 py-1.5 hover:bg-plm-bg-lighter'
  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ left: position.x, top: position.y }}
      className="fixed z-50 w-56 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1 text-sm"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose()
          openPanelPopout(tab).catch((error) =>
            log.warn('[PanelPopout]', 'Could not pop out a tab', { tab, error: String(error) }),
          )
        }}
        className={itemClass}
      >
        <ExternalLink size={14} />
        {poppedOut
          ? t('source.details.popoutShowWindow')
          : t('source.details.popOut', { tab: popoutTabLabel(tab) })}
      </button>
      {poppedOut && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose()
            requestPanelPopoutClose(tab)
          }}
          className={itemClass}
        >
          {t('source.details.popoutBringBack')}
        </button>
      )}
    </div>
  )
}

/** The tab's body while it is in its own window. */
export function PoppedOutPlaceholder({ tab }: { tab: DetailsPanelTab }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-sm text-plm-fg-muted text-center">
      <ExternalLink size={22} className="opacity-60" />
      {t('source.details.popoutPlaceholder', { tab: popoutTabLabel(tab) })}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => requestPanelPopoutClose(tab)}
      >
        {t('source.details.popoutBringBack')}
      </button>
    </div>
  )
}
