/**
 * Clipboard entries for the context menu (in the default layout under Edit): `edit.copy`,
 * `edit.cut`, `edit.paste`. They move files on disk, so desktop only.
 */
import { Copy, Scissors, ClipboardPaste } from 'lucide-react'
import { useFilePaneContext } from '../../../context'
import { hasDesktop } from '@/lib/platform'
import type { EntryHookResult } from '../customizable/types'
import type { ActionComponentProps } from './types'

export interface ClipboardEntriesProps extends ActionComponentProps {
  handleCopy: () => void
  handleCut: () => void
  handlePaste: () => void
}

export function useClipboardEntries({
  onClose,
  handleCopy,
  handleCut,
  handlePaste,
}: ClipboardEntriesProps): EntryHookResult<'edit.copy' | 'edit.cut' | 'edit.paste'> {
  if (!hasDesktop()) {
    return { entries: { 'edit.copy': null, 'edit.cut': null, 'edit.paste': null } }
  }

  return {
    entries: {
      'edit.copy': (
        <div
          className="context-menu-item"
          onClick={() => {
            handleCopy()
            onClose()
          }}
        >
          <Copy size={14} />
          Copy
          <span className="text-xs text-plm-fg-muted ml-auto">Ctrl+C</span>
        </div>
      ),
      'edit.cut': (
        <div
          className="context-menu-item"
          onClick={() => {
            handleCut()
            onClose()
          }}
        >
          <Scissors size={14} />
          Cut
          <span className="text-xs text-plm-fg-muted ml-auto">Ctrl+X</span>
        </div>
      ),
      'edit.paste': <PasteEntry onClose={onClose} handlePaste={handlePaste} />,
    },
  }
}

function PasteEntry({ onClose, handlePaste }: { onClose: () => void; handlePaste: () => void }) {
  const { clipboard } = useFilePaneContext()

  return (
    <div
      className={`context-menu-item ${!clipboard ? 'disabled' : ''}`}
      onClick={() => {
        if (clipboard) {
          handlePaste()
        }
        onClose()
      }}
    >
      <ClipboardPaste size={14} />
      Paste
      <span className="text-xs text-plm-fg-muted ml-auto">Ctrl+V</span>
    </div>
  )
}
