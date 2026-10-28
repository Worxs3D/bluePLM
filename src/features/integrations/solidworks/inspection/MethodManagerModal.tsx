import { useState, useCallback, useMemo } from 'react'

import { t } from '@/lib/i18n'
import type { InspectionMethodOption } from '@/lib/supabase'
import { Plus, Trash2, X, Pencil, Check, Settings2 } from 'lucide-react'

interface MethodManagerModalProps {
  methods: InspectionMethodOption[]
  builtInMethods: string[]
  onAdd: (name: string) => Promise<boolean>
  onRename: (id: string, name: string) => Promise<boolean>
  onRemove: (id: string) => Promise<boolean>
  onClose: () => void
}

/** A merged list entry: built-in methods have a null id (read-only); org methods have an id. */
interface MethodListRow {
  id: string | null
  name: string
}

export function MethodManagerModal({
  methods,
  builtInMethods,
  onAdd,
  onRename,
  onRemove,
  onClose,
}: MethodManagerModalProps) {
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  // Built-in + custom, custom wins on case-insensitive clash, always alphabetically sorted.
  const rows = useMemo<MethodListRow[]>(() => {
    const map = new Map<string, MethodListRow>()
    for (const name of builtInMethods) {
      const key = name.trim().toLowerCase()
      if (key) map.set(key, { id: null, name: name.trim() })
    }
    for (const method of methods) {
      const key = method.name.trim().toLowerCase()
      if (key) map.set(key, { id: method.id, name: method.name.trim() })
    }
    return [...map.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    )
  }, [builtInMethods, methods])

  const handleAdd = useCallback(async () => {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    const ok = await onAdd(name)
    setBusy(false)
    if (ok) setNewName('')
  }, [newName, busy, onAdd])

  const commitEdit = useCallback(
    async (id: string) => {
      const name = editingValue.trim()
      if (!name) {
        setEditingId(null)
        return
      }
      setBusy(true)
      const ok = await onRename(id, name)
      setBusy(false)
      if (ok) setEditingId(null)
    },
    [editingValue, onRename],
  )

  const handleRemove = useCallback(
    async (id: string) => {
      if (busy) return
      setBusy(true)
      await onRemove(id)
      setBusy(false)
    },
    [busy, onRemove],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-plm-bg border border-plm-border rounded-lg shadow-xl w-full max-w-md max-h-[80vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-plm-border">
          <div className="flex items-center gap-2 text-sm font-medium text-plm-fg">
            <Settings2 size={15} />
            {t('source.inspection.methodsTitle')}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-plm-border/50 text-plm-fg/70"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-b border-plm-border">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleAdd()
              }
            }}
            placeholder={t('source.inspection.addMethodPlaceholder')}
            className="flex-1 bg-plm-bg border border-plm-border rounded px-2 py-1 text-sm"
            autoFocus
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!newName.trim() || busy}
            className="btn btn-secondary btn-sm gap-1"
          >
            <Plus size={12} />
            {t('source.inspection.addMethodButton')}
          </button>
        </div>

        <div className="flex-1 overflow-auto py-1">
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-plm-fg/50">
              {t('source.inspection.noMethods')}
            </div>
          ) : (
            rows.map((row) => (
              <div
                key={row.id ?? `builtin:${row.name}`}
                className="flex items-center gap-2 px-4 py-1.5 hover:bg-plm-bg/40 group"
              >
                {row.id !== null && row.id === editingId ? (
                  <>
                    <input
                      type="text"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void commitEdit(row.id as string)
                        }
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="flex-1 bg-plm-bg border border-plm-border rounded px-2 py-1 text-sm"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => void commitEdit(row.id as string)}
                      disabled={busy}
                      className="p-1 rounded hover:bg-plm-border/50 text-plm-fg/70"
                      title={t('common.save')}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="p-1 rounded hover:bg-plm-border/50 text-plm-fg/70"
                      title={t('common.cancel')}
                    >
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-plm-fg/90 truncate">{row.name}</span>
                    {row.id !== null ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(row.id)
                            setEditingValue(row.name)
                          }}
                          className="p-1 rounded hover:bg-plm-border/50 text-plm-fg/60 opacity-0 group-hover:opacity-100"
                          title={t('common.edit')}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemove(row.id as string)}
                          disabled={busy}
                          className="p-1 rounded hover:bg-plm-error/20 text-plm-error opacity-0 group-hover:opacity-100"
                          title={t('common.delete')}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wide text-plm-fg/40 px-1">
                        {t('source.inspection.builtIn')}
                      </span>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
