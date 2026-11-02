/**
 * The selection, in the footer of the findings card.
 *
 * The controls act on every selectable row the filter lets through - not on the rows currently
 * drawn - and the count is in the unit the writer works in. A file write counts files and a value
 * write counts values, so "Select all 42" is never followed by a write of twelve.
 */

import { EyeOff } from 'lucide-react'

import { t } from '@/lib/i18n'

import { countOf, type CountUnit } from './vaultAuditLabels'
import type { SelectionSummary } from './vaultAuditSelection'

interface VaultAuditSelectionBarProps {
  summary: SelectionSummary
  unit: CountUnit
  /** What to do, shown while nothing is selected. */
  prompt: string
  disabled: boolean
  onSelectAll: () => void
  onClear: () => void
  onInvert: () => void
  onClearHidden: () => void
}

const LINK_BUTTON =
  'text-[13px] text-ui-accent hover:underline disabled:opacity-40 disabled:no-underline'

export function VaultAuditSelectionBar({
  summary,
  unit,
  prompt,
  disabled,
  onSelectAll,
  onClear,
  onInvert,
  onClearHidden,
}: VaultAuditSelectionBarProps) {
  const { selectableUnits, selectedUnits, allSelected, hiddenSelectedUnits } = summary
  if (selectableUnits === 0 && hiddenSelectedUnits === 0) return null

  return (
    <>
      {selectedUnits === 0 ? (
        <>
          <span className="text-ui-fg-secondary">{prompt}</span>
          {selectableUnits > 0 && (
            <button type="button" onClick={onSelectAll} disabled={disabled} className={LINK_BUTTON}>
              {t(
                selectableUnits === 1
                  ? 'vaultAudit.findings.selectOnePhrase'
                  : 'vaultAudit.findings.selectAllPhrase',
                { items: countOf(unit, selectableUnits) },
              )}
            </button>
          )}
        </>
      ) : (
        <>
          <span className="font-medium text-ui-fg" aria-live="polite">
            {t('vaultAudit.findings.selectedPhrase', {
              selected: selectedUnits,
              total: countOf(unit, selectableUnits),
            })}
          </span>
          {!allSelected && (
            <button type="button" onClick={onSelectAll} disabled={disabled} className={LINK_BUTTON}>
              {t('vaultAudit.findings.selectAllPhrase', { items: countOf(unit, selectableUnits) })}
            </button>
          )}
          <button type="button" onClick={onClear} disabled={disabled} className={LINK_BUTTON}>
            {t('vaultAudit.findings.clearSelection')}
          </button>
          {selectableUnits > 1 && (
            <button type="button" onClick={onInvert} disabled={disabled} className={LINK_BUTTON}>
              {t('vaultAudit.findings.invert')}
            </button>
          )}
        </>
      )}

      {hiddenSelectedUnits > 0 && (
        <span className="flex items-center gap-1.5 text-ui-warning">
          <EyeOff size={12} className="flex-shrink-0" />
          {t('vaultAudit.findings.hiddenSelected', { count: hiddenSelectedUnits })}
          <button type="button" onClick={onClearHidden} disabled={disabled} className={LINK_BUTTON}>
            {t('vaultAudit.findings.clearHidden')}
          </button>
        </span>
      )}
    </>
  )
}
