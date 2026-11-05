/**
 * The Generate entries (in the default layout under Generate, above Reviews):
 *
 * - On server: outputs recorded against the latest checked-in version, shown under the file and
 *   in the Outputs column (`generate.server.pdf` for drawings, `generate.server.step` for
 *   drawings, parts and assemblies), and for one drawing `generate.server.inspectionReport` > one
 *   entry per template (`InspectionTemplateItems`). Desktop, explorer edit or admin.
 * - Local: the export options that write ordinary files (PDF, STEP, IGES, STL, DXF, STEP of a
 *   drawing's model, the metadata table of PDF and STEP files), and
 *   `generate.local.inspectionReport` > a template to build a workbook and save it, recording
 *   nothing.
 *
 * The groups themselves (Generate, On server, Local) belong to the layout.
 */
import { FileSpreadsheet } from 'lucide-react'

import { generateMenuKinds } from '@/features/source/outputs/outputRowModel'
import { DEFAULT_LAYOUT } from '@/lib/contextMenu/entries'
import type { MenuLayout } from '@/lib/contextMenu/types'
import { t } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import { usePDMStore } from '@/stores/pdmStore'

import { ContextMenuGroup } from '../components'
import { CustomizableMenu } from '../customizable/CustomizableMenu'
import type { EntryHookResult } from '../customizable/types'
import { useExportEntries } from './ExportActions'
import { useExportTableEntries } from './ExportMetadataTableActions'
import { useGenerateOutputEntries } from './GenerateOutputActions'
import { InspectionTemplateItems } from './InspectionTemplateItems'
import type { ActionComponentProps } from './types'

type GenerateEntryId =
  | 'generate.server.pdf'
  | 'generate.server.step'
  | 'generate.server.inspectionReport'
  | 'generate.local.table'
  | 'generate.local.step'
  | 'generate.local.iges'
  | 'generate.local.stl'
  | 'generate.local.pdf'
  | 'generate.local.dxf'
  | 'generate.local.stepFromDrawing'
  | 'generate.local.exportOptions'
  | 'generate.local.inspectionReport'

export function useGenerateEntries(props: ActionComponentProps): EntryHookResult<GenerateEntryId> {
  const { contextFiles, multiSelect, firstFile, onClose } = props
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const hasPermission = usePDMStore((s) => s.hasPermission)
  const desktop = hasDesktop()
  const canEdit = getEffectiveRole() === 'admin' || hasPermission('module:explorer', 'edit')

  const counts = generateMenuKinds(contextFiles)
  const oneDrawing =
    !multiSelect &&
    !firstFile?.isDirectory &&
    firstFile?.extension?.toLowerCase() === '.slddrw' &&
    !!firstFile.pdmData?.id &&
    !!firstFile.pdmData.version
  const hasServer = desktop && canEdit && (counts.pdf > 0 || counts.step > 0)

  const server = useGenerateOutputEntries(props)
  const table = useExportTableEntries(props)
  const exports = useExportEntries(props)

  return {
    entries: {
      ...server.entries,
      'generate.server.inspectionReport':
        hasServer && oneDrawing && canEdit ? (
          <ContextMenuGroup
            flyoutKey="generate.server.inspectionReport"
            label={t('contextMenu.generate.inspectionReport')}
            icon={FileSpreadsheet}
            minWidth={240}
          >
            <InspectionTemplateItems file={firstFile} mode="server" onClose={onClose} />
          </ContextMenuGroup>
        ) : null,
      ...table.entries,
      ...exports.entries,
      'generate.local.inspectionReport': oneDrawing ? (
        <ContextMenuGroup
          flyoutKey="generate.local.inspectionReport"
          label={t('contextMenu.generate.inspectionReport')}
          icon={FileSpreadsheet}
          minWidth={220}
        >
          <InspectionTemplateItems file={firstFile} mode="local" onClose={onClose} />
        </ContextMenuGroup>
      ) : null,
    },
  }
}

/** The default layout's Generate group alone. */
const GENERATE_ONLY_LAYOUT: MenuLayout = {
  v: 1,
  hidden: [],
  removedGroups: [],
  nodes: DEFAULT_LAYOUT.nodes.filter((node) => node.kind === 'group' && node.id === 'generate'),
}

/**
 * The Generate group as one menu item, for a menu not yet drawn from a layout (the explorer
 * tree's, until it moves to `CustomizableMenu`).
 */
export function GenerateSubmenu(props: ActionComponentProps) {
  const { entries } = useGenerateEntries(props)
  return <CustomizableMenu entries={entries} layout={GENERATE_ONLY_LAYOUT} hideCustomize />
}
