/**
 * The exports of an item's released version (schema 509), shown first in the expanded item: the
 * frozen production outputs (PDF, STEP, ...) of exactly the released version. Read once when the
 * item is expanded (`listOutputsForVersions` with one version id).
 */
import { useEffect, useState } from 'react'
import { BadgeCheck, Download } from 'lucide-react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { outputKindLabel } from '@/lib/outputs/kinds'
import { listOutputsForVersions } from '@/lib/supabase/versionOutputs'
import { openOutput } from '@/features/source/outputs/outputCommands'
import { usePDMStore } from '@/stores/pdmStore'
import type { ItemRow } from '@/types/item'
import type { VersionOutput } from '@/types/versionOutputs'

export function ReleasedExportsSection({ row }: { row: ItemRow }) {
  const release = row.release
  const versionId = release?.fileVersionId ?? null
  const [outputs, setOutputs] = useState<VersionOutput[] | null>(null)
  const primaryFile = usePDMStore((s) =>
    row.primaryFileId ? s.files.find((f) => f.pdmData?.id === row.primaryFileId) : undefined,
  )

  useEffect(() => {
    if (!versionId) return
    let cancelled = false
    setOutputs(null)
    listOutputsForVersions([versionId])
      .then((byVersion) => {
        if (!cancelled) setOutputs(byVersion.get(versionId) ?? [])
      })
      .catch((error: unknown) => {
        log.warn('[ItemBrowser]', 'Reading released exports failed', { error, versionId })
        if (!cancelled) setOutputs([])
      })
    return () => {
      cancelled = true
    }
  }, [versionId])

  if (!release) return null

  return (
    <div className="space-y-1.5 lg:col-span-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-plm-success">
        <BadgeCheck size={12} />
        <span>{t('releases.itemReleasedExports', { version: release.version })}</span>
      </div>
      <div className="space-y-0.5">
        {outputs === null ? null : outputs.length === 0 ? (
          <div className="px-2 py-1 text-plm-fg-muted/70 text-xs">{t('releases.itemNoReleasedExports')}</div>
        ) : (
          outputs.map((output) => (
            <button
              key={output.id}
              type="button"
              disabled={!primaryFile}
              onClick={() => primaryFile && void openOutput(primaryFile, output)}
              className="flex items-center gap-2 w-full px-2 py-1 rounded text-left text-plm-fg-muted hover:bg-plm-bg-light hover:text-plm-fg transition-colors disabled:opacity-60"
              title={output.fileName ?? outputKindLabel(output.kind)}
            >
              <Download size={14} className="text-plm-success" />
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-plm-bg shrink-0">
                {outputKindLabel(output.kind)}
              </span>
              <span className="truncate flex-1 min-w-0">{output.fileName ?? row.primaryFile?.name ?? ''}</span>
              {output.configuration && (
                <span className="text-[10px] text-plm-fg-muted shrink-0">{output.configuration}</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
