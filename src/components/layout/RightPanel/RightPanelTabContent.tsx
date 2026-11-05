import { useState, useEffect, useMemo } from 'react'
import { useHiddenDetailsTabs } from '@/hooks/useOfficialExtensionInstalled'
import type { LocalFile, DetailsPanelTab } from '@/stores/pdmStore'
import { buildThumbnailUrl } from '@/lib/thumbnailUrl'
import { useRetryableImage } from '@/hooks/useRetryableImage'
import { getFileIconType } from '@/lib/utils'
import { formatFileSize } from '@/lib/utils'
import { resolvePartNumber, resolveRevision, resolvedText } from '@/lib/metadata/overlay'
import { WhereUsedTab } from '@/features/integrations/solidworks'
import { InspectionTab } from '@/features/integrations/solidworks'
import { CadFilePreview } from '@/features/source/details/components/CadFilePreview'
import { ChildPreview } from '@/features/source/outputs/preview/ChildPreview'
import {
  childKey,
  type ChildPreviewTarget,
} from '@/features/source/outputs/preview/childPreviewModel'
import { VendorsTab } from '@/features/source/details/VendorsTab'
import { FileOrdersTab } from '@/features/orders/FileOrdersTab'
import { FileBox, Layers, File, Loader2, FilePen } from 'lucide-react'

// Component to load OS icon for files
function RightPanelIcon({ file, size = 24 }: { file: LocalFile; size?: number }) {
  const iconUrl = useMemo(() => buildThumbnailUrl(file, 'grid'), [file])
  const { src, onError } = useRetryableImage(iconUrl)

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="flex-shrink-0 rounded"
        style={{ width: size, height: size }}
        decoding="async"
        onError={onError}
      />
    )
  }

  // Fallback to React icons
  const iconType = getFileIconType(file.extension)
  const iconClassMap: Record<string, string> = {
    part: 'text-plm-accent',
    assembly: 'text-amber-400',
    drawing: 'text-sky-300',
    step: 'text-orange-400',
    pdf: 'text-red-400',
    image: 'text-purple-400',
  }
  const iconClass = iconClassMap[iconType] || 'text-plm-fg-muted'
  const iconMap: Record<string, typeof File> = {
    part: FileBox,
    assembly: Layers,
    drawing: FilePen,
  }
  const IconComponent = iconMap[iconType] || File
  return <IconComponent size={size} className={iconClass} />
}

function FileProperties({ file }: { file: LocalFile }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <RightPanelIcon file={file} size={24} />
        <div className="min-w-0">
          <div className="font-medium truncate">{file.name}</div>
          <div className="text-xs text-plm-fg-muted truncate">{file.relativePath}</div>
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-plm-fg-muted">Item Number</span>
          <span>{resolvedText(resolvePartNumber(file), '-')}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-plm-fg-muted">Revision</span>
          <span>{resolvedText(resolveRevision(file), '-')}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-plm-fg-muted">Version</span>
          <span>{file.pdmData?.version || 1}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-plm-fg-muted">Size</span>
          <span>{formatFileSize(file.size)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-plm-fg-muted">Status</span>
          <span>
            {file.pdmData
              ? 'Synced'
              : file.diffStatus === 'ignored'
                ? 'Local only (ignored)'
                : 'Local only'}
          </span>
        </div>
      </div>
    </div>
  )
}

function FilePreview({ file }: { file: LocalFile }) {
  const ext = file.extension?.toLowerCase() || ''
  const isSolidWorksFile = ['.sldprt', '.sldasm', '.slddrw'].includes(ext)
  const isCADFile = [
    '.sldprt',
    '.sldasm',
    '.slddrw',
    '.step',
    '.stp',
    '.stl',
    '.iges',
    '.igs',
  ].includes(ext)
  const isImageFile = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext)
  const isPDFFile = ext === '.pdf'

  // PDF preview state
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)

  // Load PDF when file changes
  useEffect(() => {
    const loadPdf = async () => {
      if (!file.path || !isPDFFile) {
        setPdfDataUrl(null)
        return
      }
      setPdfLoading(true)
      try {
        const result = await window.electronAPI?.readFile(file.path)
        if (result?.success && result.data) {
          setPdfDataUrl(`data:application/pdf;base64,${result.data}`)
        }
      } catch {
        // Shown as "Failed to load PDF".
      } finally {
        setPdfLoading(false)
      }
    }
    loadPdf()
  }, [file.path, isPDFFile])

  return (
    <div className="flex flex-col h-full">
      {isPDFFile ? (
        pdfLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : pdfDataUrl ? (
          <iframe src={pdfDataUrl} className="w-full h-full border-0 rounded bg-white" />
        ) : (
          <div className="flex-1 flex items-center justify-center text-plm-fg-muted">
            Failed to load PDF
          </div>
        )
      ) : isImageFile ? (
        <div className="flex-1 flex items-center justify-center">
          <img
            src={`file://${file.path}`}
            alt={file.name}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      ) : isCADFile ? (
        // The right panel shares the CAD fallback logic, but intentionally never owns
        // the single native child window. Embedded mode remains in DetailsPanel only.
        <CadFilePreview
          file={file}
          solidWorks={isSolidWorksFile}
          embeddedAvailable={false}
          preferThumbnailInExternalMode
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-plm-fg-muted">
          No preview available
        </div>
      )}
    </div>
  )
}

interface RightPanelTabContentProps {
  tab: DetailsPanelTab
  file: LocalFile
  /** An output or report row selected under the file: Preview shows it instead of the file. */
  childTarget: ChildPreviewTarget | null
  /** Where Used row clicked; defaults to selecting the file in this window. */
  onNavigate?: (filePath: string) => void
}

/**
 * One file's content in a right-panel tab. Shared by the right panel and the popped-out tab
 * windows (`panelPopout/`), so a popped-out tab shows exactly what the panel would.
 */
export function RightPanelTabContent({
  tab,
  file,
  childTarget,
  onNavigate,
}: RightPanelTabContentProps) {
  const hiddenTabs = useHiddenDetailsTabs()
  if (hiddenTabs.has(tab)) return null
  const ext = file.extension?.toLowerCase() || ''
  switch (tab) {
    case 'properties':
      return <FileProperties file={file} />
    case 'preview':
      return childTarget ? (
        <ChildPreview key={childKey(childTarget)} target={childTarget} />
      ) : (
        <FilePreview file={file} />
      )
    case 'whereused':
      return <WhereUsedTab file={file} onNavigate={onNavigate} />
    case 'vendors':
      return <VendorsTab file={file} />
    case 'orders':
      return file.isDirectory ? null : <FileOrdersTab file={file} />
    case 'inspection':
      return ext === '.slddrw' ? <InspectionTab file={file} /> : null
    default:
      return null
  }
}
