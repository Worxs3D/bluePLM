/**
 * Assembly entry for the context menu: `assembly.insert` ("Insert into Assembly") for SolidWorks
 * parts/subassemblies. The open assemblies are read from SOLIDWORKS when the flyout opens.
 */
import { useState, useRef, useEffect } from 'react'
import { Boxes } from 'lucide-react'
import type { ActionComponentProps } from './types'
import type { LocalFile } from '@/stores/pdmStore'
import { ContextSubmenu } from '../components'
import { usePDMStore } from '@/stores/pdmStore'
import { useShallow } from 'zustand/react/shallow'
import { log } from '@/lib/logger'
import { hasDesktop } from '@/lib/platform'
import { useFlyout } from '../customizable/flyout'
import type { EntryHookResult } from '../customizable/types'
import { SubmenuArrow } from '../components/SubmenuArrow'

interface OpenAssembly {
  filePath: string
  fileName: string
  fileType: string
  isReadOnly: boolean
  isDirty: boolean
  activeConfiguration: string
}

/** Only for single SolidWorks parts/assemblies (multi-insert not yet supported). */
function isSolidWorksInsertable(ext: string | undefined): boolean {
  const lowerExt = ext?.toLowerCase()
  return lowerExt === '.sldprt' || lowerExt === '.sldasm'
}

export function useAssemblyEntries({
  multiSelect,
  firstFile,
  onClose,
}: ActionComponentProps): EntryHookResult<'assembly.insert'> {
  const solidworksEnabled = usePDMStore((s) => s.solidworksIntegrationEnabled)

  // Only show for single SolidWorks parts/assemblies (multi-insert not yet supported)
  const canInsert =
    hasDesktop() &&
    !multiSelect &&
    isSolidWorksInsertable(firstFile.extension) &&
    firstFile.diffStatus !== 'cloud' &&
    solidworksEnabled

  return {
    entries: {
      'assembly.insert': canInsert ? (
        <InsertIntoAssemblyEntry firstFile={firstFile} onClose={onClose} />
      ) : null,
    },
  }
}

function InsertIntoAssemblyEntry({
  firstFile,
  onClose,
}: {
  firstFile: LocalFile
  onClose: () => void
}) {
  const flyout = useFlyout('assembly.insert')
  const showSubmenu = flyout.isOpen
  const [openAssemblies, setOpenAssemblies] = useState<OpenAssembly[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isInserting, setIsInserting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasFetchedRef = useRef(false)

  const { addToast } = usePDMStore(useShallow((s) => ({ addToast: s.addToast })))

  // Reset state when submenu closes so re-opening can fetch fresh data
  useEffect(() => {
    if (!showSubmenu) {
      hasFetchedRef.current = false
      setOpenAssemblies([])
      setError(null)
    }
  }, [showSubmenu])

  // Fetch open assemblies when submenu is shown (only once per open)
  useEffect(() => {
    if (showSubmenu && !hasFetchedRef.current) {
      hasFetchedRef.current = true
      setIsLoading(true)
      setError(null)

      window.electronAPI?.solidworks
        .getOpenDocuments()
        .then((result) => {
          if (result?.success && result.data?.documents) {
            // Filter to only assemblies
            const assemblies = result.data.documents.filter(
              (doc) =>
                doc.fileType === 'Assembly' || doc.filePath.toLowerCase().endsWith('.sldasm'),
            )
            setOpenAssemblies(assemblies)
          } else if (!result?.success) {
            setError(result?.error || 'Failed to check SolidWorks')
            log.error('[AssemblyActions]', 'getOpenDocuments returned failure', {
              error: result?.error,
            })
          }
        })
        .catch((error) => {
          const errorMsg = error instanceof Error ? error.message : String(error)
          setError('Failed to connect to SolidWorks')
          log.error('[AssemblyActions]', 'Failed to fetch open documents', { error: errorMsg })
        })
        .finally(() => {
          setIsLoading(false)
        })
    }
  }, [showSubmenu])

  // Handle insert into assembly
  const handleInsert = async (assembly: OpenAssembly) => {
    if (isInserting) return

    setIsInserting(true)
    const partName = firstFile.name
    const assemblyName = assembly.fileName

    addToast('info', `Adding ${partName} to ${assemblyName}...`)

    try {
      const result = await window.electronAPI?.solidworks.addComponent(
        assembly.filePath,
        firstFile.path,
      )

      if (result?.success) {
        addToast('success', `Added ${partName} to ${assemblyName}`)
        log.info('[AssemblyActions]', 'Successfully added component', { data: result.data })
      } else {
        addToast('error', result?.error || 'Failed to add component')
        log.error('[AssemblyActions]', 'Failed to add component', { error: result?.error })
      }
    } catch (error) {
      addToast('error', 'Failed to add component to assembly')
      log.error('[AssemblyActions]', 'Exception adding component', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsInserting(false)
      onClose()
    }
  }

  return (
    <div
      className="context-menu-item relative"
      onMouseEnter={flyout.onMouseEnter}
      onMouseLeave={flyout.onMouseLeave}
      onClick={(e) => {
        e.stopPropagation()
        flyout.toggle()
      }}
    >
      <Boxes size={14} className="text-plm-accent-primary" />
      Insert into Assembly
      <SubmenuArrow />
      {showSubmenu && (
        <ContextSubmenu
          minWidth={200}
          onMouseEnter={flyout.onMouseEnter}
          onMouseLeave={flyout.onMouseLeave}
        >
          {isLoading ? (
            <div className="context-menu-item disabled">
              <span className="animate-pulse">Checking SolidWorks...</span>
            </div>
          ) : error ? (
            <div className="context-menu-item disabled text-plm-error">{error}</div>
          ) : openAssemblies.length > 0 ? (
            openAssemblies.map((assembly) => (
              <div
                key={assembly.filePath}
                className="context-menu-item"
                onClick={(e) => {
                  e.stopPropagation()
                  handleInsert(assembly)
                }}
                title={assembly.filePath}
              >
                <Boxes size={14} className="text-plm-fg-muted" />
                <span className="truncate">{assembly.fileName}</span>
                {assembly.isDirty && <span className="text-xs text-plm-warning ml-auto">*</span>}
              </div>
            ))
          ) : (
            <div className="context-menu-item disabled">No assemblies open in SolidWorks</div>
          )}
        </ContextSubmenu>
      )}
    </div>
  )
}
