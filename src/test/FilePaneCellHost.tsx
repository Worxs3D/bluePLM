/**
 * Renders one file-list cell the way FilePane does: inside the real `FilePaneProvider` and
 * `FilePaneHandlersProvider`, with the handlers that matter to a metadata cell coming from the
 * real `useFileEditHandlers` and `useConfigHandlers` (start edit, save, the SolidWorks write,
 * editability). Handlers no metadata cell calls are inert. Use with `// @vitest-environment jsdom`
 * and the integration harness, so the store, the database and the service behind the cell are
 * the real store and the harness fakes.
 */
import { useMemo, useRef, useState, type ComponentType } from 'react'

import { FilePaneHandlersProvider, FilePaneProvider } from '@/features/source/browser/context'
import type { FilePaneHandlersContextValue } from '@/features/source/browser/context'
import type { CellRendererBaseProps } from '@/features/source/browser/components/FileList/cells/types'
import { useConfigHandlers } from '@/features/source/browser/hooks/useConfigHandlers'
import { useFileEditHandlers } from '@/features/source/browser/hooks/useFileEditHandlers'
import { useMetadataWritesInFlight } from '@/features/source/browser/hooks/useMetadataWritesInFlight'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'

const noop = () => {}

export interface FilePaneCellHostProps {
  relativePath: string
  Cell: ComponentType<CellRendererBaseProps>
}

export function FilePaneCellHost({ relativePath, Cell }: FilePaneCellHostProps) {
  const files = usePDMStore((s) => s.files)
  const user = usePDMStore((s) => s.user)
  const vaultPath = usePDMStore((s) => s.vaultPath)
  const organization = usePDMStore((s) => s.organization)
  const addToast = usePDMStore((s) => s.addToast)
  const addProgressToast = usePDMStore((s) => s.addProgressToast)
  const updateProgressToast = usePDMStore((s) => s.updateProgressToast)
  const removeToast = usePDMStore((s) => s.removeToast)
  const updatePendingMetadata = usePDMStore((s) => s.updatePendingMetadata)
  const setSelectedFiles = usePDMStore((s) => s.setSelectedFiles)

  const [editingCell, setEditingCell] = useState<{ path: string; column: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [renamingFile, setRenamingFile] = useState<LocalFile | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [highlightingFile, setHighlightingFile] = useState<LocalFile | null>(null)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const inlineEditInputRef = useRef<HTMLInputElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const highlightInputRef = useRef<HTMLInputElement | null>(null)
  const newFolderInputRef = useRef<HTMLInputElement | null>(null)
  const lastClickedConfigRef = useRef<string | null>(null)
  const justSavedConfigs = useRef<Set<string>>(new Set())

  const savingConfigsToSW = useMetadataWritesInFlight()

  const config = useConfigHandlers({
    files,
    lastClickedConfigRef,
    justSavedConfigs,
    configContextMenu: null,
    setConfigContextMenu: noop,
    setIsExportingConfigs: noop,
    setSelectedFiles,
    organization,
    addToast,
    addProgressToast,
    updateProgressToast,
    removeToast,
  })

  const edit = useFileEditHandlers({
    files,
    vaultPath,
    currentPath: '',
    user,
    renamingFile,
    setRenamingFile,
    renameValue,
    setRenameValue,
    renameInputRef,
    isCreatingFolder,
    setIsCreatingFolder,
    newFolderName,
    setNewFolderName,
    newFolderInputRef,
    editingCell,
    setEditingCell,
    editValue,
    setEditValue,
    inlineEditInputRef,
    setContextMenu: noop,
    setEmptyContextMenu: noop,
    addToast,
    updatePendingMetadata,
    onRefresh: noop,
    saveConfigsToSWFile: config.saveConfigsToSWFile,
  })

  const handlers = useMemo<FilePaneHandlersContextValue>(
    () => ({
      handleInlineDownload: noop,
      handleInlineGetLatest: noop,
      handleInlineUpload: noop,
      handleInlineCheckout: noop,
      handleInlineCheckin: noop,
      selectedCloudOnlyFiles: [],
      selectedUploadableFiles: [],
      selectedCheckoutableFiles: [],
      selectedCheckinableFiles: [],
      selectedUpdatableFiles: [],
      isBeingProcessed: () => false,
      getProcessingOperation: () => null,
      getFolderCheckoutStatus: () => null,
      isFolderSynced: () => true,
      isFileEditable: edit.isFileEditable,
      canHaveConfigs: config.canHaveConfigs,
      toggleFileConfigExpansion: (file) => void config.toggleFileConfigExpansion(file),
      hasPendingMetadataChanges: config.hasPendingMetadataChanges,
      savingConfigsToSW,
      saveConfigsToSWFile: (file, pending) => void config.saveConfigsToSWFile(file, pending),
      onConfigSectionsToggle: noop,
      onConfigGroupToggle: noop,
      canHaveDrawingRefs: config.canHaveDrawingRefs,
      toggleDrawingRefExpansion: (file) => void config.toggleDrawingRefExpansion(file),
      handleRename: () => void edit.handleRename(),
      handleSaveCellEdit: () => void edit.handleSaveCellEdit(),
      handleCancelCellEdit: edit.handleCancelCellEdit,
      handleStartCellEdit: edit.handleStartCellEdit,
    }),
    [config, edit, savingConfigsToSW],
  )

  const file = files.find((f) => f.relativePath === relativePath && !f.isDirectory)

  return (
    <FilePaneProvider
      onRefresh={noop}
      renameState={{
        renamingFile,
        setRenamingFile,
        renameValue,
        setRenameValue,
        renameInputRef,
        highlightingFile,
        setHighlightingFile,
        highlightInputRef,
        isCreatingFolder,
        setIsCreatingFolder,
        newFolderName,
        setNewFolderName,
        newFolderInputRef,
        editingCell,
        setEditingCell,
        editValue,
        setEditValue,
        inlineEditInputRef,
      }}
    >
      <FilePaneHandlersProvider handlers={handlers}>
        <div data-testid="cell">{file ? <Cell file={file} /> : 'no file'}</div>
      </FilePaneHandlersProvider>
    </FilePaneProvider>
  )
}
