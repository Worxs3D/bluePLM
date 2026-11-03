import { memo, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Box, ChevronDown, ChevronRight, FileText, Loader2, PenTool, Plus } from 'lucide-react'

import { generateOutputs } from '@/features/source/outputs/outputCommands'
import { t } from '@/lib/i18n'
import { outputKindLabel } from '@/lib/outputs/kinds'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { VersionOutputKind } from '@/types/versionOutputs'

import { CHILD_INDENT_PX } from './ChildRowParts'
import { fileSectionKey, fileSectionLabelKey } from './fileSections'
import type { FileSectionVirtualRow } from './rowTypes'

/**
 * A section header under an expanded file (`fileSections.ts`): a chevron that opens or closes the
 * section for this session, its name and its count. Opening Used in reads it
 * (`useModelSectionsLoader`).
 */
export const FileSectionRow = memo(function FileSectionRow({
  row,
  rowHeight,
  visibleColumns,
}: {
  row: FileSectionVirtualRow
  rowHeight: number
  visibleColumns: { id: string; width: number }[]
}) {
  const toggle = usePDMStore((s) => s.toggleFileSection)
  const label = t(fileSectionLabelKey(row.section, row.count))
  const toggleTitle = row.isExpanded ? t('source.configTree.collapse', 'Collapse') : t('source.configTree.expand', 'Expand')
  const onToggle = (e: MouseEvent) => {
    e.stopPropagation()
    toggle(fileSectionKey(row.file.path, row.section))
  }

  return (
    <tr className="config-group-row cursor-pointer hover:bg-plm-bg-light/50" style={{ height: rowHeight }} onClick={onToggle}>
      {visibleColumns.map((column) => (
        <td key={column.id} style={{ width: column.width }}>
          {column.id === 'name' ? (
            <div
              className="flex items-center gap-1.5"
              style={{ minHeight: rowHeight - 8, paddingLeft: `${CHILD_INDENT_PX}px` }}
            >
              <span className="w-2.5 shrink-0 text-[10px] text-plm-fg-dim/70">├</span>
              <button
                type="button"
                onClick={onToggle}
                className="-ml-1 rounded p-0.5 transition-colors hover:bg-plm-bg-light"
                title={toggleTitle}
                aria-label={toggleTitle}
                aria-expanded={row.isExpanded}
              >
                {row.isLoading ? (
                  <Loader2 size={10} className="animate-spin text-plm-fg-muted" />
                ) : row.isExpanded ? (
                  <ChevronDown size={10} className="text-plm-fg-muted" />
                ) : (
                  <ChevronRight size={10} className="text-plm-fg-muted" />
                )}
              </button>
              <span className="truncate text-xs font-medium uppercase tracking-wide text-plm-fg-dim">{label}</span>
              {row.count !== null && <span className="text-[10px] text-plm-fg-dim">({row.count})</span>}
            </div>
          ) : null}
        </td>
      ))}
    </tr>
  )
})

function KindIcon({ kind }: { kind: VersionOutputKind }) {
  if (kind === 'pdf') return <FileText size={14} className="text-red-400" />
  if (kind === 'dxf') return <PenTool size={14} className="text-amber-400" />
  return <Box size={14} className="text-sky-400" />
}

/**
 * "Generate…" at the end of a file's Exports: a small menu of the kinds the file can have, each
 * generated in the background from the latest checked-in version, in its saved configuration.
 */
export const FileGenerateRow = memo(function FileGenerateRow({
  file,
  kinds,
  rowHeight,
  visibleColumns,
}: {
  file: LocalFile
  kinds: VersionOutputKind[]
  rowHeight: number
  visibleColumns: { id: string; width: number }[]
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const open = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <>
      <tr
        className="drawing-ref-row cursor-pointer hover:bg-plm-bg-light/50"
        style={{ height: rowHeight }}
        title={t('source.outputs.generateRowTitle')}
        onClick={open}
        onContextMenu={open}
      >
        {visibleColumns.map((column) => (
          <td key={column.id} style={{ width: column.width }}>
            {column.id === 'name' ? (
              <div
                className="flex items-center gap-1.5"
                style={{ minHeight: rowHeight - 8, paddingLeft: `${CHILD_INDENT_PX}px` }}
              >
                <span className="w-2.5 shrink-0 text-[10px] text-plm-fg-dim/70">├</span>
                <span className="flex w-3.5 shrink-0 justify-center">
                  <Plus size={14} className="text-plm-fg-muted" />
                </span>
                <span className="truncate text-sm italic text-plm-fg-muted">{t('source.outputs.generateRow')}</span>
              </div>
            ) : null}
          </td>
        ))}
      </tr>
      {menu &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-50"
              onClick={(e) => {
                e.stopPropagation()
                setMenu(null)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setMenu(null)
              }}
            />
            <div
              className="context-menu z-[60]"
              role="menu"
              style={{ left: menu.x, top: menu.y }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-plm-fg-dim">
                {t('source.outputs.generateMenuSaved')}
              </div>
              {kinds.map((kind) => (
                <div
                  key={kind}
                  className="context-menu-item"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenu(null)
                    generateOutputs([file], kind)
                  }}
                >
                  <KindIcon kind={kind} />
                  {outputKindLabel(kind)}
                </div>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  )
})
