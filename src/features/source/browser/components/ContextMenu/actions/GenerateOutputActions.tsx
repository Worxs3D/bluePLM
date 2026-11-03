/**
 * "Generate PDF" (drawings) and "Generate STEP" (parts and assemblies) on the selection: one
 * background job per checked-in file, from its latest version's staged closure (5.5.0). Desktop
 * only (generation needs SOLIDWORKS), for users with explorer edit or admin. A recorded output is
 * reused, so generating again only fills in the missing ones.
 */
import { Box, FileText } from 'lucide-react'

import { generateMenuKinds } from '@/features/source/outputs/outputRowModel'
import { generateOutputs } from '@/features/source/outputs/outputCommands'
import { t } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import { usePDMStore } from '@/stores/pdmStore'

import type { ActionComponentProps } from './types'

export function GenerateOutputActions({ contextFiles, onClose }: ActionComponentProps) {
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const hasPermission = usePDMStore((s) => s.hasPermission)
  const canEdit = getEffectiveRole() === 'admin' || hasPermission('module:explorer', 'edit')
  if (!hasDesktop() || !canEdit) return null
  const counts = generateMenuKinds(contextFiles)
  if (counts.pdf === 0 && counts.step === 0) return null

  return (
    <>
      {counts.pdf > 0 && (
        <div
          className="context-menu-item"
          onClick={() => {
            onClose()
            generateOutputs(contextFiles, 'pdf')
          }}
          title={t('source.outputs.generateHint', { kind: 'PDF' })}
        >
          <FileText size={14} />
          {counts.pdf > 1 ? t('source.outputs.generatePdfCount', { count: counts.pdf }) : t('source.outputs.generatePdf')}
        </div>
      )}
      {counts.step > 0 && (
        <div
          className="context-menu-item"
          onClick={() => {
            onClose()
            generateOutputs(contextFiles, 'step')
          }}
          title={t('source.outputs.generateHint', { kind: 'STEP' })}
        >
          <Box size={14} />
          {counts.step > 1 ? t('source.outputs.generateStepCount', { count: counts.step }) : t('source.outputs.generateStep')}
        </div>
      )}
    </>
  )
}
