import { Move } from 'lucide-react'
import { t } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import type { LocalFile } from '@/stores/pdmStore'
import type { DialogName } from '../types'
import type { EntryHookResult } from '@/features/source/browser/components/ContextMenu/customizable/types'

interface MovedFileEntriesProps {
  firstFile: LocalFile
  multiSelect: boolean
  openDialog: (name: DialogName) => void
}

/**
 * `moves.resolve`: a single-file entry point into `ResolveMovedFilesDialog`, for the file the
 * user is already looking at rather than the folder-tree badge. `'moved'` and `'moved_away'` are
 * the exact two statuses `FileStatusCell` and `DiffStatusBadge` treat as "this file is part of a
 * pending move" (see `.cursor/plans/pending-move-visibility-agent2-report.md`). Desktop only.
 */
export function useTreeMovedFileEntries({
  firstFile,
  multiSelect,
  openDialog,
}: MovedFileEntriesProps): EntryHookResult<'moves.resolve'> {
  const isMoved = firstFile.diffStatus === 'moved' || firstFile.diffStatus === 'moved_away'

  return {
    entries: {
      'moves.resolve':
        hasDesktop() && !multiSelect && isMoved ? (
          <div
            className="context-menu-item text-plm-info"
            onClick={() => openDialog('resolveMoves')}
          >
            <Move size={14} />
            {t('resolveMoves.contextMenuItem')}
          </div>
        ) : null,
    },
  }
}
