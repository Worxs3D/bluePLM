import { Plus, X } from 'lucide-react'

import { Button, Select, Switch, TextInput } from '@/components/core/ui'
import { useTranslation } from '@/lib/i18n'
import type { MetadataColumnType } from '@/types/database'

import { SettingRow, SettingsGroup } from '../components/ui'

const TYPE_LABEL_KEYS: Record<MetadataColumnType, string> = {
  text: 'settingsPages.metadata.typeText',
  number: 'settingsPages.metadata.typeNumber',
  date: 'settingsPages.metadata.typeDate',
  boolean: 'settingsPages.metadata.typeBoolean',
  select: 'settingsPages.metadata.typeSelect',
}

export function getMetadataColumnTypeLabel(type: MetadataColumnType, t: (key: string) => string) {
  return t(TYPE_LABEL_KEYS[type])
}

export interface EditingColumn {
  id?: string
  name: string
  label: string
  data_type: MetadataColumnType
  select_options: string[]
  width: number
  visible: boolean
  sortable: boolean
  required: boolean
  default_value: string
}

export const DEFAULT_COLUMN: EditingColumn = {
  name: '',
  label: '',
  data_type: 'text',
  select_options: [],
  width: 120,
  visible: true,
  sortable: true,
  required: false,
  default_value: '',
}

interface MetadataColumnEditorProps {
  column: EditingColumn
  onChange: (column: EditingColumn) => void
  isCreating: boolean
  isSaving: boolean
  newOption: string
  onNewOptionChange: (value: string) => void
  onAddOption: () => void
  onRemoveOption: (option: string) => void
  onCancel: () => void
  onSave: () => void
}

/** The create / edit form of one custom metadata column (admins only). */
export function MetadataColumnEditor({
  column,
  onChange,
  isCreating,
  isSaving,
  newOption,
  onNewOptionChange,
  onAddOption,
  onRemoveOption,
  onCancel,
  onSave,
}: MetadataColumnEditorProps) {
  const { t } = useTranslation()
  return (
    <SettingsGroup>
      <div className="py-3 text-[14px] font-semibold text-ui-fg">
        {isCreating ? t('settingsPages.metadata.newColumn') : t('settingsPages.metadata.editColumn')}
      </div>

      <SettingRow
        label={t('settingsPages.metadata.internalName')}
        htmlFor="metadata-column-name"
        description={t('settingsPages.metadata.internalNameHelp')}
      >
        <TextInput
          id="metadata-column-name"
          value={column.name}
          onChange={(e) =>
            onChange({
              ...column,
              name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
            })
          }
          placeholder={t('settingsPages.metadata.internalNamePlaceholder')}
          className="!w-64 font-mono"
          disabled={!isCreating}
        />
      </SettingRow>

      <SettingRow label={t('settingsPages.metadata.displayLabel')} htmlFor="metadata-column-label">
        <TextInput
          id="metadata-column-label"
          value={column.label}
          onChange={(e) => onChange({ ...column, label: e.target.value })}
          placeholder={t('settingsPages.metadata.displayLabelPlaceholder')}
          className="!w-64"
        />
      </SettingRow>

      <SettingRow label={t('settingsPages.metadata.dataType')} htmlFor="metadata-column-type">
        <Select
          id="metadata-column-type"
          value={column.data_type}
          onChange={(e) =>
            onChange({
              ...column,
              data_type: e.target.value as MetadataColumnType,
              select_options: e.target.value === 'select' ? column.select_options : [],
            })
          }
          className="w-64"
        >
          {Object.keys(TYPE_LABEL_KEYS).map((value) => (
            <option key={value} value={value}>
              {getMetadataColumnTypeLabel(value as MetadataColumnType, t)}
            </option>
          ))}
        </Select>
      </SettingRow>

      <SettingRow label={t('settingsPages.metadata.columnWidth')} htmlFor="metadata-column-width">
        <TextInput
          id="metadata-column-width"
          type="number"
          value={column.width}
          onChange={(e) =>
            onChange({ ...column, width: Math.max(50, parseInt(e.target.value) || 120) })
          }
          min={50}
          max={500}
          className="!w-24"
        />
      </SettingRow>

      <SettingRow label={t('settingsPages.metadata.defaultValue')} htmlFor="metadata-column-default">
        <TextInput
          id="metadata-column-default"
          value={column.default_value}
          onChange={(e) => onChange({ ...column, default_value: e.target.value })}
          placeholder={t('settingsPages.metadata.optional')}
          className="!w-64"
        />
      </SettingRow>

      {column.data_type === 'select' && (
        <SettingRow label={t('settingsPages.metadata.dropdownOptions')} stacked>
          <div className="space-y-2">
            <div className="flex gap-2">
              <TextInput
                value={newOption}
                onChange={(e) => onNewOptionChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onAddOption()
                  }
                }}
                placeholder={t('settingsPages.metadata.addOptionPlaceholder')}
                className="flex-1"
              />
              <Button
                icon={<Plus size={14} />}
                onClick={onAddOption}
                disabled={!newOption.trim()}
                aria-label={t('settingsPages.metadata.addOption')}
              />
            </div>
            {column.select_options.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {column.select_options.map((option) => (
                  <span
                    key={option}
                    className="inline-flex items-center gap-1 rounded-md bg-ui-field px-2 py-1 text-[13px] text-ui-fg"
                  >
                    {option}
                    <button
                      type="button"
                      onClick={() => onRemoveOption(option)}
                      className="rounded p-0.5 text-ui-fg-secondary hover:text-ui-danger"
                      aria-label={t('settingsPages.metadata.removeOption', { option })}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </SettingRow>
      )}

      <SettingRow label={t('settingsPages.metadata.visibleByDefault')}>
        <Switch
          checked={column.visible}
          onChange={(visible) => onChange({ ...column, visible })}
          aria-label={t('settingsPages.metadata.visibleByDefault')}
        />
      </SettingRow>
      <SettingRow label={t('settingsPages.metadata.sortable')}>
        <Switch
          checked={column.sortable}
          onChange={(sortable) => onChange({ ...column, sortable })}
          aria-label={t('settingsPages.metadata.sortable')}
        />
      </SettingRow>
      <SettingRow label={t('settingsPages.metadata.required')}>
        <Switch
          checked={column.required}
          onChange={(required) => onChange({ ...column, required })}
          aria-label={t('settingsPages.metadata.required')}
        />
      </SettingRow>

      <div className="flex justify-end gap-2 py-3">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('settingsPages.metadata.cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onSave}
          loading={isSaving}
          disabled={!column.name.trim() || !column.label.trim()}
        >
          {isSaving
            ? t('settingsPages.metadata.saving')
            : isCreating
              ? t('settingsPages.metadata.createColumn')
              : t('settingsPages.metadata.saveChanges')}
        </Button>
      </div>
    </SettingsGroup>
  )
}
