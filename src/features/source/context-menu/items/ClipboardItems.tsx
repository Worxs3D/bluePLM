/**
 * The explorer tree's clipboard entries: `edit.copy`, `edit.cut` and `edit.paste`, each offered
 * when the tree passed its handler. They move files on disk, so not on BluePLM Web.
 */
import { Copy, Scissors, ClipboardPaste } from 'lucide-react'
import type { LocalFile } from '@/stores/pdmStore'
import { hasDesktop } from '@/lib/platform'
import type { EntryHookResult } from '@/features/source/browser/components/ContextMenu/customizable/types'

export interface ClipboardEntriesProps {
  clipboard: { files: LocalFile[]; operation: 'copy' | 'cut' } | null | undefined
  onCopy?: () => void
  onCut?: () => void
  onPaste?: () => void
  onClose: () => void
}

export function useTreeClipboardEntries({
  clipboard,
  onCopy,
  onCut,
  onPaste,
  onClose,
}: ClipboardEntriesProps): EntryHookResult<'edit.copy' | 'edit.cut' | 'edit.paste'> {
  const desktop = hasDesktop()

  return {
    entries: {
      'edit.copy':
        desktop && onCopy ? (
          <div
            className="context-menu-item"
            onClick={() => {
              onCopy()
              onClose()
            }}
          >
            <Copy size={14} />
            Copy
            <span className="text-xs text-plm-fg-muted ml-auto">Ctrl+C</span>
          </div>
        ) : null,

      'edit.cut':
        desktop && onCut ? (
          <div
            className="context-menu-item"
            onClick={() => {
              onCut()
              onClose()
            }}
          >
            <Scissors size={14} />
            Cut
            <span className="text-xs text-plm-fg-muted ml-auto">Ctrl+X</span>
          </div>
        ) : null,

      'edit.paste':
        desktop && onPaste ? (
          <div
            className={`context-menu-item ${!clipboard ? 'disabled' : ''}`}
            onClick={() => {
              if (clipboard) {
                onPaste()
                onClose()
              }
            }}
          >
            <ClipboardPaste size={14} />
            Paste
            <span className="text-xs text-plm-fg-muted ml-auto">Ctrl+V</span>
          </div>
        ) : null,
    },
  }
}
