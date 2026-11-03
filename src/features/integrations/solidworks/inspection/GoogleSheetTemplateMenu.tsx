import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, FileSpreadsheet, Loader2 } from 'lucide-react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { InspectionRowInput } from '@/lib/supabase'
import { resolveFileMetadata, resolvedText } from '@/lib/metadata/overlay'
import {
  getInspectionTemplates,
  generateInspectionSheet,
  isGoogleDriveConnected,
  type InspectionTemplateFile,
} from '@/features/integrations/google-drive/lib/sheetTemplates'

import { uploadInspectionPreview } from './uploadPreview'
import { COLUMNS } from './inspectionColumns'

interface GoogleSheetTemplateMenuProps {
  file: LocalFile
  fileId: string
  orgId: string | undefined
  /** Org-configured Drive folder holding the templates. */
  templateFolderId: string
  /** Rows in the order shown. */
  rows: InspectionRowInput[]
}

/** "Generate template": fill a Google Sheets template from the org's Drive folder with the table. */
export function GoogleSheetTemplateMenu({
  file,
  fileId,
  orgId,
  templateFolderId,
  rows,
}: GoogleSheetTemplateMenuProps) {
  const addToast = usePDMStore((s) => s.addToast)
  const [templates, setTemplates] = useState<InspectionTemplateFile[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Close the dropdown on outside click
  useEffect(() => {
    if (!open) return
    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Load the template list from the org's Drive folder when the dropdown opens
  const loadTemplates = useCallback(async () => {
    if (!isGoogleDriveConnected()) {
      addToast('info', t('source.inspection.templateConnectDrive'))
      return
    }
    setTemplatesLoading(true)
    try {
      const result = await getInspectionTemplates(templateFolderId)
      if (!result.success) {
        if (result.error === 'NOT_CONNECTED') {
          addToast('info', t('source.inspection.templateConnectDrive'))
        } else {
          addToast('error', t('source.inspection.templateListFailed'))
        }
        setTemplates([])
        return
      }
      setTemplates(result.templates ?? [])
    } finally {
      setTemplatesLoading(false)
    }
  }, [templateFolderId, addToast])

  const handleToggle = useCallback(() => {
    if (!open) void loadTemplates()
    setOpen(!open)
  }, [open, loadTemplates])

  const handleGenerate = useCallback(
    async (template: InspectionTemplateFile) => {
      setOpen(false)
      setIsGenerating(true)
      try {
        // The sheet is generated from what is on screen right now - the rows below are the
        // user's uncommitted table edits - so its identifying fields follow the same overlay.
        // A report titled with the number the user has just replaced is the drawing-export bug
        // in a different deliverable.
        const identity = resolveFileMetadata(file)
        const brNumber = resolvedText(identity.partNumber)
        const revision = resolvedText(identity.revision)
        const description = resolvedText(identity.description)
        const partName = description || file.pdmData?.file_name || file.name
        const drawingName = file.pdmData?.file_name ?? file.name

        // Best-effort part preview (skipped silently when unavailable)
        const previewUrl = orgId ? await uploadInspectionPreview(file.path, fileId, orgId) : null

        // Formatted rows in the currently displayed order, keyed by field for {{COL:field}} tokens
        const formattedRows = rows.map((row) => {
          const record: Record<string, string> = {}
          for (const col of COLUMNS) {
            const value = row[col.key]
            record[col.key] = value === null || value === undefined ? '' : String(value)
          }
          return record
        })
        const columnLabels: Record<string, string> = {}
        for (const col of COLUMNS) columnLabels[col.key] = col.label

        const namePrefix = brNumber || partName
        const reportName = `${namePrefix}${revision ? ` Rev ${revision}` : ''} - ${template.name}`

        const result = await generateInspectionSheet({
          templateId: template.id,
          destinationFolderId: templateFolderId,
          reportName,
          scalarTokens: {
            BR_NUMBER: brNumber,
            PART_NAME: partName,
            DESCRIPTION: description,
            REVISION: revision,
            DATE: new Date().toLocaleDateString(),
            DRAWING_NAME: drawingName,
          },
          previewImageUrl: previewUrl,
          rows: formattedRows,
          columnLabels,
        })

        if (!result.success || !result.spreadsheetUrl) {
          if (result.error === 'NOT_CONNECTED') {
            addToast('info', t('source.inspection.templateConnectDrive'))
          } else {
            addToast('error', t('source.inspection.templateFailed'))
          }
          return
        }

        window.open(result.spreadsheetUrl, '_blank')
        addToast('success', t('source.inspection.templateSuccess'))
      } catch (error) {
        log.error('[InspectionTab]', 'Generate template failed', { error: String(error) })
        addToast('error', t('source.inspection.templateFailed'))
      } finally {
        setIsGenerating(false)
      }
    },
    [templateFolderId, file, fileId, orgId, rows, addToast],
  )

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={handleToggle}
        disabled={isGenerating}
        className="btn btn-secondary btn-sm gap-1"
        title={t('source.inspection.generateTemplate')}
      >
        {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />}
        {isGenerating ? t('source.inspection.generating') : t('source.inspection.generateTemplate')}
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-56 max-h-72 overflow-auto rounded-md border border-plm-border bg-plm-bg shadow-lg py-1">
          {templatesLoading ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-plm-fg/60">
              <Loader2 size={12} className="animate-spin" />
              {t('source.inspection.templateLoading')}
            </div>
          ) : templates.length === 0 ? (
            <div className="px-3 py-2 text-xs text-plm-fg/60">{t('source.inspection.templateNone')}</div>
          ) : (
            templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => void handleGenerate(template)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-plm-fg hover:bg-plm-bg/40"
              >
                <FileSpreadsheet size={12} className="flex-shrink-0 text-plm-fg/60" />
                <span className="truncate">{template.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
