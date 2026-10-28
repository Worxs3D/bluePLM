import { ArrowLeftRight } from 'lucide-react'

interface FolderMovedBadgeProps {
  onClick: (e: React.MouseEvent) => void
  /** Pending moves under the folder, each counted once. */
  totalCount: number
  title: string
}

/**
 * Pending-move badge for a folder row, in the folder tree and the file list.
 *
 * A move is two rows (the file at its new path, and the stub left at its old one), so a folder
 * that holds both sides holds one pending decision. Callers pass a count that already counts each
 * move once - see `stubCountsAsMoveIn` - so the number matches the dialog the badge opens.
 */
export function FolderMovedBadge({ onClick, totalCount, title }: FolderMovedBadgeProps) {
  return (
    <button
      className="group/moved flex items-center gap-0 px-1.5 py-0.5 rounded-md transition-all duration-200 bg-white/10 text-blue-400 hover:bg-blue-400/30 hover:gap-1"
      onClick={onClick}
      title={title}
    >
      <ArrowLeftRight size={12} className="transition-colors duration-200" />
      <span className="text-[10px] font-medium text-blue-400 max-w-0 overflow-hidden transition-all duration-200 group-hover/moved:max-w-[2rem]">
        {totalCount}
      </span>
    </button>
  )
}
