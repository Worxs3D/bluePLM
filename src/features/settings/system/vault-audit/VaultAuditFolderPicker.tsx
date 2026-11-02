/**
 * The folder box for a one-folder audit: type to search the vault's folders, or browse them.
 *
 * It used to be a bare text field, and the only way to fill it was to know the path or paste one.
 * A pasted absolute path came back blank until the scan learned to cut it back to the vault, and a
 * misspelt one still does, after the admin has already committed to a run. So the box now offers
 * the vault's own folders as you type (by name or by path), a tree to browse them, and says what
 * the scope will match before the run instead of after: how many parts and assemblies BluePLM has
 * under the folder, and how many of those this machine cannot open.
 *
 * Matching goes through `findFolder`, which reads the text exactly as the scan does, so a folder
 * shown as matched is one the run will match. On leaving the box a recognised path is rewritten to
 * the folder's vault-relative path in the vault's own casing.
 */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderTree, X } from 'lucide-react'

import { Button, FIELD_CLASS } from '@/components/core/ui'
import { t } from '@/lib/i18n'

import {
  ancestorKeys,
  folderKey,
  suggestFolders,
  type VaultAuditFolder,
  type VaultAuditFolderIndex,
} from './vaultAuditFolders'

interface VaultAuditFolderPickerProps {
  value: string
  onChange: (relativePath: string) => void
  index: VaultAuditFolderIndex
  /** The folder `value` names, or null. Worked out by the caller, which also gates the run on it. */
  match: VaultAuditFolder | null
  vaultPath: string
  disabled: boolean
}

function FolderCount({ folder }: { folder: VaultAuditFolder }) {
  return (
    <span
      className="ml-auto flex-shrink-0 pl-3 text-[12px] font-mono tabular-nums text-ui-fg-secondary"
      title={t(`vaultAudit.scope.folderCountTitle_${folder.modelCount === 1 ? 'one' : 'other'}`, {
        count: folder.modelCount,
      })}
    >
      {folder.modelCount}
    </span>
  )
}

function FolderTreeRows({
  parentKey,
  index,
  expanded,
  selectedKey,
  onToggle,
  onSelect,
}: {
  parentKey: string
  index: VaultAuditFolderIndex
  expanded: ReadonlySet<string>
  selectedKey: string
  onToggle: (key: string) => void
  onSelect: (folder: VaultAuditFolder) => void
}) {
  const folders = index.children.get(parentKey) ?? []
  return (
    <>
      {folders.map((folder) => {
        const key = folder.relativePath.toLowerCase()
        const hasChildren = index.children.has(key)
        const isOpen = expanded.has(key)
        const isSelected = key === selectedKey
        const Glyph = isOpen ? FolderOpen : Folder
        return (
          <li key={key} role="treeitem" aria-expanded={hasChildren ? isOpen : undefined}>
            <div
              className={`flex items-center gap-1 rounded-md pr-2 text-[13px] ${
                isSelected ? 'bg-ui-selected text-ui-fg' : 'text-ui-fg hover:bg-ui-hover'
              }`}
              style={{ paddingLeft: `${folder.depth * 16 + 4}px` }}
            >
              <button
                type="button"
                tabIndex={-1}
                onClick={() => hasChildren && onToggle(key)}
                className={`flex h-6 w-5 flex-shrink-0 items-center justify-center text-ui-fg-secondary ${
                  hasChildren ? 'hover:text-ui-fg' : 'invisible'
                }`}
                aria-label={folder.name}
              >
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              <button
                type="button"
                onClick={() => onSelect(folder)}
                onDoubleClick={() => hasChildren && onToggle(key)}
                aria-pressed={isSelected}
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                title={folder.relativePath}
              >
                <Glyph
                  size={14}
                  className={`flex-shrink-0 ${isOpen ? 'text-ui-accent' : 'text-ui-fg-secondary'}`}
                />
                <span className={`truncate ${isSelected ? 'font-medium' : ''}`}>{folder.name}</span>
                <FolderCount folder={folder} />
              </button>
            </div>
            {hasChildren && isOpen && (
              <ul role="group">
                <FolderTreeRows
                  parentKey={key}
                  index={index}
                  expanded={expanded}
                  selectedKey={selectedKey}
                  onToggle={onToggle}
                  onSelect={onSelect}
                />
              </ul>
            )}
          </li>
        )
      })}
    </>
  )
}

export function VaultAuditFolderPicker({
  value,
  onChange,
  index,
  match,
  vaultPath,
  disabled,
}: VaultAuditFolderPickerProps) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [browsing, setBrowsing] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  const suggestions = useMemo(
    () => (suggesting ? suggestFolders(index, value, vaultPath) : []),
    [suggesting, index, value, vaultPath],
  )
  const selectedKey = match ? match.relativePath.toLowerCase() : ''

  useEffect(() => setHighlight(-1), [value])

  // Opening the tree opens it down to the folder already chosen.
  const openTree = () => {
    setExpanded((current) => {
      if (!match) return current
      const next = new Set(current)
      for (const key of ancestorKeys(match.relativePath)) next.add(key)
      return next
    })
    setBrowsing(true)
  }

  const choose = (folder: VaultAuditFolder) => {
    onChange(folder.relativePath)
    setSuggesting(false)
  }

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSuggesting(true)
      setHighlight((current) => Math.min(current + 1, suggestions.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((current) => Math.max(current - 1, -1))
    } else if (event.key === 'Enter') {
      const picked = suggestions[highlight] ?? (suggestions.length === 1 ? suggestions[0] : null)
      if (picked) {
        event.preventDefault()
        choose(picked)
      } else {
        setSuggesting(false)
      }
    } else if (event.key === 'Escape' && suggesting) {
      event.preventDefault()
      event.stopPropagation()
      setSuggesting(false)
    }
  }

  const showSuggestions = suggesting && !disabled
  const activeId = highlight >= 0 ? `${listId}-${highlight}` : undefined

  return (
    <div className="mt-2 max-w-xl space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Folder
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ui-fg-secondary"
          />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={showSuggestions}
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-invalid={value.trim() !== '' && !match && index.folders.length > 0}
            value={value}
            disabled={disabled}
            placeholder={t('vaultAudit.scope.folderPlaceholder')}
            spellCheck={false}
            onChange={(event) => {
              onChange(event.target.value)
              setSuggesting(true)
            }}
            onFocus={() => setSuggesting(true)}
            onBlur={() => {
              setSuggesting(false)
              // A recognised path, however it was typed, becomes the folder's own path.
              if (match && match.relativePath !== value) onChange(match.relativePath)
            }}
            onKeyDown={handleKeyDown}
            className={`${FIELD_CLASS} h-7 pl-7 ${value ? 'pr-7' : 'pr-2.5'}`}
          />
          {value && !disabled && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange('')
                inputRef.current?.focus()
              }}
              title={t('vaultAudit.scope.folderClear')}
              aria-label={t('vaultAudit.scope.folderClear')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ui-fg-secondary hover:text-ui-fg"
            >
              <X size={12} />
            </button>
          )}

          {showSuggestions && (
            <ul
              id={listId}
              role="listbox"
              aria-label={t('vaultAudit.scope.folderTreeLabel')}
              className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-ui-border bg-ui-bg p-1 shadow-lg"
            >
              {suggestions.length === 0 ? (
                <li className="px-2 py-1.5 text-[13px] text-ui-fg-secondary">
                  {index.folders.length === 0
                    ? t('vaultAudit.scope.folderIndexEmpty')
                    : t('vaultAudit.scope.folderNoSuggestions', { query: value.trim() })}
                </li>
              ) : (
                suggestions.map((folder, position) => {
                  const parent = folder.relativePath.slice(
                    0,
                    Math.max(0, folder.relativePath.length - folder.name.length - 1),
                  )
                  return (
                    <li
                      key={folder.relativePath}
                      id={`${listId}-${position}`}
                      role="option"
                      aria-selected={position === highlight}
                      // Keeps the focus in the box, so the blur does not close the list first.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(folder)}
                      onMouseEnter={() => setHighlight(position)}
                      className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
                        position === highlight ? 'bg-ui-hover' : ''
                      }`}
                    >
                      <Folder size={14} className="flex-shrink-0 text-ui-fg-secondary" />
                      <span className="min-w-0 truncate" title={folder.relativePath}>
                        <span className="text-ui-fg">{folder.name}</span>
                        {parent && <span className="ml-2 text-ui-fg-secondary">{parent}</span>}
                      </span>
                      <FolderCount folder={folder} />
                    </li>
                  )
                })
              )}
            </ul>
          )}
        </div>

        <Button
          size="sm"
          icon={<FolderTree size={13} />}
          onClick={() => (browsing ? setBrowsing(false) : openTree())}
          disabled={disabled || index.folders.length === 0}
          aria-expanded={browsing}
        >
          {browsing ? t('vaultAudit.scope.folderBrowseHide') : t('vaultAudit.scope.folderBrowse')}
        </Button>
      </div>

      {browsing && !disabled && (
        <ul
          role="tree"
          aria-label={t('vaultAudit.scope.folderTreeLabel')}
          className="max-h-72 overflow-y-auto rounded-lg border border-ui-divider bg-ui-field p-1"
        >
          <FolderTreeRows
            parentKey=""
            index={index}
            expanded={expanded}
            selectedKey={selectedKey}
            onToggle={toggle}
            onSelect={(folder) => {
              onChange(folder.relativePath)
              // Choosing a folder with subfolders also opens it, which is usually the next step.
              const key = folderKey(folder.relativePath)
              if (index.children.has(key) && !expanded.has(key)) toggle(key)
            }}
          />
        </ul>
      )}
    </div>
  )
}
