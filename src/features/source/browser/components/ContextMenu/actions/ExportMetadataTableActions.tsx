/**
 * Export a CSV table (BR number, description, revision) for selected PDF / STEP files: the
 * `generate.local.table` entry, a flyout.
 */
import { useState } from 'react'
import { Loader2, Table } from 'lucide-react'
import type { LocalFile } from '@/stores/pdmStore'
import { useShallow } from 'zustand/react/shallow'
import { usePDMStore } from '@/stores/pdmStore'
import { getSerializationSettings, combineBaseAndTab } from '@/lib/serialization'
import {
  resolveConfigurationTabs,
  resolveDescription,
  resolvePartNumber,
  resolveRevision,
  resolvedText,
} from '@/lib/metadata/overlay'
import { log } from '@/lib/logger'
import { saveBlobAs } from '@/lib/browserDownload'
import { ContextSubmenu } from '../components'
import type { ActionComponentProps } from './types'
import { useFlyout } from '../customizable/flyout'
import type { EntryHookResult } from '../customizable/types'
import { SubmenuArrow } from '../components/SubmenuArrow'

/** Same as file type detection in supabase/files/mutations (STEP + PDF). */
const PDF_STEP_EXTENSIONS = new Set(['.pdf', '.step', '.stp', '.stpz', '.p21'])

function isPdfOrStepFile(f: LocalFile): boolean {
  if (f.isDirectory) return false
  const ext = f.extension?.toLowerCase() || ''
  return PDF_STEP_EXTENSIONS.has(ext)
}

function csvEscapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

async function getBrNumberForFile(
  file: LocalFile,
  organizationId: string | undefined,
): Promise<string> {
  const baseNumber = resolvedText(resolvePartNumber(file))

  // Left on truthiness deliberately, and it is not the cleared-versus-never-set distinction: the
  // fallback here runs across *configurations*, not across the two states of one field, and the
  // question it answers is "which configuration names this file". `resolveConfigurationTabs`
  // returns a merged `Record<string, string>` that carries no source per key, so a presence-aware
  // version of this line would need the merge to return resolved fields rather than strings -
  // a change to the map API rather than to this call site.
  const configTabs = resolveConfigurationTabs(file)
  const tabNumber =
    configTabs['Default'] || configTabs['default'] || Object.values(configTabs)[0] || ''
  let fullItemNumber = baseNumber
  if (tabNumber && organizationId) {
    try {
      const serSettings = await getSerializationSettings(organizationId)
      if (serSettings?.tab_enabled) {
        fullItemNumber = combineBaseAndTab(baseNumber, tabNumber, serSettings)
      } else if (baseNumber && tabNumber) {
        fullItemNumber = `${baseNumber}-${tabNumber}`
      }
    } catch (error) {
      log.debug('[ExportTable]', 'Serialization settings', { error: error })
      if (baseNumber && tabNumber) {
        fullItemNumber = `${baseNumber}-${tabNumber}`
      }
    }
  }
  return fullItemNumber
}

export function useExportTableEntries({
  contextFiles,
  onClose,
}: ActionComponentProps): EntryHookResult<'generate.local.table'> {
  const tableFiles = contextFiles.filter(isPdfOrStepFile)
  const show =
    tableFiles.length > 0 &&
    typeof window !== 'undefined' &&
    !!window.electronAPI?.saveTextFileWithDialog
  return {
    entries: {
      'generate.local.table': show ? (
        <TableExportEntry tableFiles={tableFiles} onClose={onClose} />
      ) : null,
    },
  }
}

function TableExportEntry({
  tableFiles,
  onClose,
}: {
  tableFiles: LocalFile[]
  onClose: () => void
}) {
  const { addToast, organization } = usePDMStore(
    useShallow((s) => ({
      addToast: s.addToast,
      organization: s.organization,
    })),
  )
  const [isSaving, setIsSaving] = useState(false)
  const flyout = useFlyout('generate.local.table')

  const buildCsv = async (): Promise<string> => {
    const rows: string[][] = [['BR Number', 'Description', 'Revision']]
    const orgId = organization?.id

    for (const file of tableFiles) {
      const brNumber = await getBrNumberForFile(file, orgId)
      const description = resolvedText(resolveDescription(file))
      const revision = resolvedText(resolveRevision(file)).trim()
      rows.push([csvEscapeCell(brNumber), csvEscapeCell(description), csvEscapeCell(revision)])
    }

    return rows.map((row) => row.join(',')).join('\r\n')
  }

  const handleSaveCsv = async () => {
    if (isSaving) return
    setIsSaving(true)
    onClose()
    try {
      const body = await buildCsv()
      const utf8 = `\uFEFF${body}`
      const defaultName = `export-${tableFiles.length}-files.csv`
      const api = window.electronAPI
      if (!api) {
        // BluePLM Web: the browser's own download.
        saveBlobAs(defaultName, new Blob([utf8], { type: 'text/csv;charset=utf-8' }))
        addToast('success', `Saved table (${tableFiles.length} rows)`)
        return
      }
      const result = await api.saveTextFileWithDialog(defaultName, utf8, [
        { name: 'CSV', extensions: ['csv'] },
      ])
      if (result?.success && result.path) {
        addToast('success', `Saved table (${tableFiles.length} rows)`)
      } else if (result?.canceled) {
        // no toast
      } else {
        addToast('error', result?.error ? `Save failed: ${result.error}` : 'Save failed')
      }
    } catch (error) {
      addToast('error', `Export failed: ${error}`)
    } finally {
      setIsSaving(false)
    }
  }

  const countLabel = tableFiles.length > 1 ? ` (${tableFiles.length})` : ''

  return (
    <div
      className={`context-menu-item relative ${isSaving ? 'opacity-50' : ''}`}
      onMouseEnter={flyout.onMouseEnter}
      onMouseLeave={flyout.onMouseLeave}
      onClick={(e) => {
        e.stopPropagation()
        flyout.toggle()
      }}
    >
      {isSaving ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Table size={14} className="text-sky-400" />
      )}
      Table{countLabel}
      <SubmenuArrow />
      {flyout.isOpen && (
        <ContextSubmenu
          minWidth={160}
          onMouseEnter={flyout.onMouseEnter}
          onMouseLeave={flyout.onMouseLeave}
        >
          <div
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation()
              if (!isSaving) void handleSaveCsv()
            }}
          >
            <Table size={14} className="text-sky-400" />
            Save as CSV…
          </div>
        </ContextSubmenu>
      )}
    </div>
  )
}
