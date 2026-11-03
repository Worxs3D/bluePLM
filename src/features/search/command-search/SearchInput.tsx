import { ChevronDown, Search, X } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'
import type { SearchInputProps } from './types'

/**
 * Main search input with clear button and keyboard shortcut hint
 */
export function SearchInput({
  value,
  onChange,
  onFocus,
  onKeyDown,
  placeholder,
  inputRef,
  onClear,
  quickResults,
}: SearchInputProps) {
  const { t } = useTranslation()
  const toggleLabel = quickResults?.expanded
    ? t('fileBrowser.hideQuickResults')
    : t('fileBrowser.showQuickResults')

  return (
    <div className="relative flex-1">
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted pointer-events-none"
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={`w-full h-8 pl-9 ${quickResults ? 'pr-20' : 'pr-9'} bg-plm-bg-lighter border border-plm-border rounded-full text-sm text-plm-fg placeholder:text-plm-fg-muted focus:outline-none focus:border-plm-accent focus:ring-1 focus:ring-plm-accent/50 transition-colors`}
      />

      {value && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {quickResults && (
            <button
              type="button"
              onClick={quickResults.onToggle}
              title={toggleLabel}
              aria-label={toggleLabel}
              aria-expanded={quickResults.expanded}
              className="flex items-center gap-0.5 px-1 py-0.5 text-[11px] tabular-nums text-plm-fg-muted hover:text-plm-fg rounded"
            >
              {quickResults.count}
              <ChevronDown
                size={12}
                className={`transition-transform ${quickResults.expanded ? 'rotate-180' : ''}`}
              />
            </button>
          )}
          <button
            type="button"
            onClick={onClear}
            className="p-0.5 text-plm-fg-muted hover:text-plm-fg rounded"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
