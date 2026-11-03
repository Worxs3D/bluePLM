import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Columns3, RotateCcw } from 'lucide-react'

import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'

import { columnLabel, resolveColumns, type InspectionColumnPrefs } from './inspectionColumns'

/**
 * The Columns button of the Inspection tab: show / hide and reorder the table's columns, or reset
 * them. The layout is per user (UI slice, persisted with the store).
 */
export function ColumnManager() {
  const prefs = usePDMStore((s) => s.inspectionColumnPrefs)
  const setPrefs = usePDMStore((s) => s.setInspectionColumnPrefs)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const { ordered } = resolveColumns(prefs)
  const hidden = new Set(prefs?.hidden ?? [])
  const current = (): InspectionColumnPrefs => ({
    order: ordered.map((c) => c.key),
    hidden: [...hidden],
  })

  const toggle = (key: string) => {
    const next = current()
    next.hidden = hidden.has(key) ? next.hidden.filter((k) => k !== key) : [...next.hidden, key]
    setPrefs(next)
  }

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= ordered.length) return
    const next = current()
    const [key] = next.order.splice(index, 1)
    next.order.splice(target, 0, key)
    setPrefs(next)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn btn-secondary btn-sm gap-1"
        title={t('source.inspection.columnsTitle')}
      >
        <Columns3 size={12} />
        {t('source.inspection.columns')}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-60 max-h-96 overflow-auto rounded-md border border-plm-border bg-plm-bg shadow-lg py-1">
          {ordered.map((col, index) => (
            <div key={col.key} className="flex items-center gap-1 px-2 py-0.5 text-xs text-plm-fg">
              <label className="flex flex-1 items-center gap-2 min-w-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!hidden.has(col.key)}
                  disabled={col.key === 'balloon_number'}
                  onChange={() => toggle(col.key)}
                />
                <span className="truncate">{columnLabel(col)}</span>
              </label>
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                className="p-0.5 rounded hover:bg-plm-highlight disabled:opacity-30"
                title={t('source.inspection.columnMoveUp')}
              >
                <ArrowUp size={11} />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === ordered.length - 1}
                className="p-0.5 rounded hover:bg-plm-highlight disabled:opacity-30"
                title={t('source.inspection.columnMoveDown')}
              >
                <ArrowDown size={11} />
              </button>
            </div>
          ))}
          <div className="border-t border-plm-border mt-1 pt-1 px-2">
            <button
              type="button"
              onClick={() => setPrefs(null)}
              className="flex items-center gap-1 text-xs text-plm-fg/70 hover:text-plm-fg py-0.5"
            >
              <RotateCcw size={11} />
              {t('source.inspection.columnsReset')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
