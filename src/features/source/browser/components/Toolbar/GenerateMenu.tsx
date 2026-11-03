import { memo, useEffect, useRef, useState } from 'react'
import { Box, ChevronDown, FileText, Sparkles } from 'lucide-react'

import { generateOutputs } from '@/features/source/outputs/outputCommands'
import { filesInFolder, filesNeedingOutput } from '@/features/source/outputs/outputRowModel'
import { t } from '@/lib/i18n'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'

type Scope = 'selection' | 'folder' | 'tree'

/**
 * Generate in the file pane's toolbar (desktop, explorer edit or admin): the PDFs and STEPs that
 * are missing or out of date, for the selected files, this folder, or this folder and its
 * subfolders, recorded on the server as Generate > On server does. Up-to-date outputs are left
 * alone. Counts are worked out when the menu opens, from the loaded outputs (a file whose outputs
 * were not read is counted; the queue reuses its output if it has one).
 */
export const GenerateMenu = memo(function GenerateMenu({ currentFolder }: { currentFolder: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [isOpen])

  const filesFor = (scope: Scope): LocalFile[] => {
    const state = usePDMStore.getState()
    if (scope === 'selection') {
      const selected = new Set(state.selectedFiles)
      const picked = state.files.filter((f) => selected.has(f.path))
      // A selected folder stands for everything in it.
      const inFolders = picked
        .filter((f) => f.isDirectory)
        .flatMap((folder) => filesInFolder(state.files, folder.relativePath, true))
      return [...picked.filter((f) => !f.isDirectory), ...inFolders]
    }
    return filesInFolder(state.files, currentFolder, scope === 'tree')
  }

  const groups: Array<{ scope: Scope; label: string }> = [
    { scope: 'selection', label: t('fileBrowser.generateMenu.selection') },
    { scope: 'folder', label: t('fileBrowser.generateMenu.folder') },
    { scope: 'tree', label: t('fileBrowser.generateMenu.tree') },
  ]

  const renderGroups = () => {
    const state = usePDMStore.getState()
    return groups.map(({ scope, label }, i) => {
      const files = filesFor(scope)
      const pdf = filesNeedingOutput(files, 'pdf', state.fileOutputHeads, state.outputJobs)
      const step = filesNeedingOutput(files, 'step', state.fileOutputHeads, state.outputJobs)
      const item = (kind: 'pdf' | 'step', list: LocalFile[]) => (
        <div
          className={`context-menu-item ${list.length === 0 ? 'disabled' : ''}`}
          onClick={() => {
            if (list.length === 0) return
            setIsOpen(false)
            generateOutputs(list, kind)
          }}
        >
          {kind === 'pdf' ? <FileText size={14} /> : <Box size={14} />}
          {t('fileBrowser.generateMenu.item', { kind: kind.toUpperCase() })}
          <span className="ml-auto pl-3 text-xs text-plm-fg-muted">{list.length}</span>
        </div>
      )
      return (
        <div key={scope}>
          {i > 0 && <div className="context-menu-separator" />}
          <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-plm-fg-muted">{label}</div>
          {item('pdf', pdf)}
          {item('step', step)}
        </div>
      )
    })
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        className="btn btn-sm btn-secondary gap-1"
        title={t('fileBrowser.generateMenu.title')}
        onClick={() => setIsOpen(!isOpen)}
      >
        <Sparkles size={14} />
        {t('contextMenu.generate.title')}
        <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="context-menu" style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, minWidth: 240 }}>
          {renderGroups()}
        </div>
      )}
    </div>
  )
})
