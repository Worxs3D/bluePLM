import { t } from '@/lib/i18n'
import type { VaultAuditCategory, VaultAuditCategoryKind, VaultAuditTone } from '@/types/vaultAudit'

import { categoryDescription, categoryLabel, categoryShortLabel } from './vaultAuditLabels'

interface VaultAuditCategoriesProps {
  categories: VaultAuditCategory[]
  selected: VaultAuditCategoryKind | null
  onSelect: (kind: VaultAuditCategoryKind) => void
}

const TONE_DOT: Record<VaultAuditTone, string> = {
  critical: 'bg-ui-danger',
  warning: 'bg-ui-warning',
  repairable: 'bg-ui-accent',
  neutral: 'bg-ui-fg-tertiary',
}

/**
 * The six categories, worst first, as tabs above the file list.
 *
 * All six are always shown, including the empty ones, because "no values are lost" is the answer
 * an administrator came for and a tab that disappears when it hits zero cannot give it. An empty
 * tab is dimmed and shows its zero.
 *
 * A tab names what is wrong in a few words; the heading under the tabs names the fix ("Copy the
 * file's value into BluePLM") and the evidence. They used to be a rail beside the list, which in a
 * settings dialog took a quarter of the width the values need and wrapped every name onto two
 * lines.
 */
export function VaultAuditCategories({
  categories,
  selected,
  onSelect,
}: VaultAuditCategoriesProps) {
  return (
    <div
      role="tablist"
      aria-label={t('vaultAudit.category.heading')}
      className="flex flex-wrap gap-1.5"
    >
      {categories.map((category) => {
        const empty = category.valueCount === 0
        const isSelected = selected === category.kind

        return (
          <button
            key={category.kind}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelect(category.kind)}
            disabled={empty}
            title={`${categoryLabel(category.kind)}. ${categoryDescription(category.kind)}`}
            className={`inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/50 ${
              isSelected
                ? 'border-ui-selected-border bg-ui-selected text-ui-fg'
                : 'border-ui-divider text-ui-fg-secondary hover:bg-ui-hover hover:text-ui-fg'
            } ${empty ? 'opacity-45 cursor-default hover:bg-transparent hover:text-ui-fg-secondary' : ''}`}
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${empty ? 'bg-ui-fg-tertiary' : TONE_DOT[category.tone]}`}
            />
            <span className={isSelected ? 'font-medium' : ''}>
              {categoryShortLabel(category.kind)}
            </span>
            <span className="tabular-nums text-ui-fg-secondary">{category.valueCount}</span>
          </button>
        )
      })}
    </div>
  )
}
