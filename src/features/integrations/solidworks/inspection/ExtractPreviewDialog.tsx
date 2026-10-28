import type { ReactNode } from 'react'

import { t } from '@/lib/i18n'
import type { InspectionRowValues } from '@/lib/supabase'
import { ScanSearch, X } from 'lucide-react'

import { COLUMNS, SYMBOL_FONT } from './inspectionColumns'
import type { PreviewItem } from './drawingCharacteristicsFlow'
import type { PendingExtract } from './useDrawingCharacteristics'

interface ExtractPreviewDialogProps {
  pending: PendingExtract
  onToggleRemove: (rowId: string) => void
  onConfirm: () => void
  onCancel: () => void
}

function fieldLabel(field: keyof InspectionRowValues): string {
  if (field === 'source_key') return t('source.inspection.fieldSourceKey')
  if (field === 'source_view') return t('source.inspection.fieldSourceView')
  return COLUMNS.find((c) => c.key === field)?.label ?? field
}

function ItemText({ item }: { item: PreviewItem }) {
  return (
    <>
      <span className="w-10 shrink-0 font-medium text-plm-fg">{item.balloon || '—'}</span>
      <span className="flex-1 truncate text-plm-fg" style={{ fontFamily: SYMBOL_FONT }}>
        {item.summary || '—'}
      </span>
      {item.sheet && <span className="shrink-0 text-plm-fg-muted">{item.sheet}</span>}
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-plm-fg-muted mb-1">
        {title}
      </div>
      <div className="bg-plm-bg rounded border border-plm-border divide-y divide-plm-border max-h-48 overflow-auto">
        {children}
      </div>
    </div>
  )
}

/**
 * Preview of an "Extract from drawing" merge: what is added, what changes, and which rows lost
 * their annotation. Missing rows are removed only while their tick stays on (default on).
 */
export function ExtractPreviewDialog({
  pending,
  onToggleRemove,
  onConfirm,
  onCancel,
}: ExtractPreviewDialogProps) {
  const { preview, removeIds } = pending
  const { counts } = preview

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('source.inspection.extractPreviewTitle')}
        className="bg-plm-bg-light border border-plm-border rounded-lg shadow-2xl w-[640px] max-w-[95vw] max-h-[85vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-4 border-b border-plm-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-plm-info/20 flex items-center justify-center">
              <ScanSearch size={20} className="text-plm-info" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-plm-fg">
                {t('source.inspection.extractPreviewTitle')}
              </h3>
              <p className="text-sm text-plm-fg-muted">
                {t('source.inspection.extractPreviewCounts', {
                  added: counts.added,
                  updated: counts.updated,
                  adopted: counts.adopted,
                  missing: counts.missing,
                  unchanged: counts.unchanged,
                })}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="btn btn-ghost p-1"
            aria-label={t('common.cancel')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-auto text-xs">
          {preview.added.length > 0 && (
            <Section title={t('source.inspection.extractAdded', { count: counts.added })}>
              {preview.added.map((item) => (
                <div key={item.rowId} className="flex items-center gap-2 px-2 py-1">
                  <ItemText item={item} />
                </div>
              ))}
            </Section>
          )}

          {preview.updated.length > 0 && (
            <Section
              title={t('source.inspection.extractUpdated', {
                count: counts.updated + counts.adopted,
              })}
            >
              {preview.updated.map((item) => (
                <div key={item.rowId} className="px-2 py-1">
                  <div className="flex items-center gap-2">
                    <ItemText item={item} />
                    {item.adopted && (
                      <span className="shrink-0 rounded bg-plm-info/20 text-plm-info px-1.5 text-[10px]">
                        {t('source.inspection.extractAdoptedBadge')}
                      </span>
                    )}
                  </div>
                  <div className="pl-12 text-plm-fg-muted">
                    {t('source.inspection.extractChanged', {
                      fields: item.changedFields.map(fieldLabel).join(', '),
                    })}
                  </div>
                </div>
              ))}
            </Section>
          )}

          {preview.missing.length > 0 && (
            <Section title={t('source.inspection.extractMissing', { count: counts.missing })}>
              <div className="px-2 py-1 text-plm-warning">
                {t('source.inspection.extractMissingHint')}
              </div>
              {preview.missing.map((item) => (
                <label
                  key={item.rowId}
                  className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-plm-bg-light"
                >
                  <input
                    type="checkbox"
                    checked={removeIds.has(item.rowId)}
                    onChange={() => onToggleRemove(item.rowId)}
                    className="accent-plm-accent"
                    aria-label={t('source.inspection.extractRemoveRow', {
                      balloon: item.balloon || '—',
                    })}
                  />
                  <ItemText item={item} />
                  {item.onIncompleteSheet && (
                    <span className="shrink-0 rounded bg-plm-warning/20 text-plm-warning px-1.5 text-[10px]">
                      {t('source.inspection.extractIncompleteBadge')}
                    </span>
                  )}
                </label>
              ))}
            </Section>
          )}

          {preview.incompleteSheets.length > 0 && (
            <p className="text-plm-warning">
              {t('source.inspection.extractIncompleteSheets', {
                sheets: preview.incompleteSheets.join(', '),
              })}
            </p>
          )}

          {preview.unreadable.length > 0 && (
            <Section
              title={t('source.inspection.extractUnreadable', { count: counts.unreadable })}
            >
              <div className="px-2 py-1 text-plm-fg-muted">
                {t('source.inspection.extractUnreadableHint')}
              </div>
              {preview.unreadable.map((item) => (
                <div key={item.rowId} className="flex items-center gap-2 px-2 py-1">
                  <ItemText item={item} />
                </div>
              ))}
            </Section>
          )}

          {counts.manual > 0 && (
            <p className="text-plm-fg-muted">
              {t('source.inspection.extractManualNote', { count: counts.manual })}
            </p>
          )}
        </div>

        <div className="p-4 border-t border-plm-border flex justify-end gap-2">
          <button onClick={onCancel} className="btn btn-ghost">
            {t('common.cancel')}
          </button>
          <button onClick={onConfirm} className="btn btn-primary">
            {t('source.inspection.extractApply')}
          </button>
        </div>
      </div>
    </div>
  )
}
