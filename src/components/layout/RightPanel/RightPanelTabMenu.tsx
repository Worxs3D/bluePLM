import { useEffect, useRef } from 'react'
import { ExternalLink } from 'lucide-react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { openInspectionPopout } from '@/features/integrations/solidworks/inspection/popout/inspectionPopout'

interface RightPanelTabMenuProps {
  position: { x: number; y: number }
  onClose: () => void
}

/** Context menu of the Inspection tab header in the right panel: pop the tab out. */
export function RightPanelTabMenu({ position, onClose }: RightPanelTabMenuProps) {
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
          openInspectionPopout(t('source.inspection.popoutWindowTitle')).catch((error) =>
            log.warn('[RightPanel]', 'Could not pop out the Inspection tab', {
              error: String(error),
            }),
          )
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-plm-bg-lighter"
      >
        <ExternalLink size={14} />
        {t('source.inspection.popOut')}
      </button>
    </div>
  )
}
