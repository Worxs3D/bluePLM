import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, Loader2, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { Badge, Button, Switch, TextInput } from '@/components/core/ui'
import { log } from '@/lib/logger'
import { supabase } from '@/lib/supabase'
import { useTranslation, t as translate } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import type { FileMetadataColumn } from '@/types/database'

import { SettingRow, SettingsGroup, SettingsPage, SettingsSection } from '../components/ui'
import { MetadataColumnDialogs } from './MetadataColumnDialogs'
import {
  DEFAULT_COLUMN,
  getMetadataColumnTypeLabel,
  MetadataColumnEditor,
  type EditingColumn,
} from './MetadataColumnEditor'

// Supabase v2 type inference incomplete for metadata column operations
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any // TODO: type this

const TABLE_HEAD = 'pb-2 pt-3 text-[13px] text-ui-fg-secondary'

export function MetadataColumnsSettings() {
  const { t } = useTranslation()
  const {
    user,
    organization,
    addToast,
    columns: builtinColumns,
    toggleColumnVisibility,
    setColumnWidth,
    saveOrgColumnDefaults,
    loadOrgColumnDefaults,
    forceOrgColumnDefaults,
    saveUserColumnDefaults,
    loadUserColumnDefaults,
    resetColumnsToDefaults,
    getEffectiveRole,
  } = usePDMStore(
    useShallow((s) => ({
      user: s.user,
      organization: s.organization,
      addToast: s.addToast,
      columns: s.columns,
      toggleColumnVisibility: s.toggleColumnVisibility,
      setColumnWidth: s.setColumnWidth,
      saveOrgColumnDefaults: s.saveOrgColumnDefaults,
      loadOrgColumnDefaults: s.loadOrgColumnDefaults,
      forceOrgColumnDefaults: s.forceOrgColumnDefaults,
      saveUserColumnDefaults: s.saveUserColumnDefaults,
      loadUserColumnDefaults: s.loadUserColumnDefaults,
      resetColumnsToDefaults: s.resetColumnsToDefaults,
      getEffectiveRole: s.getEffectiveRole,
    })),
  )

  const [columns, setColumns] = useState<FileMetadataColumn[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isSavingDefaults, setIsSavingDefaults] = useState(false)
  const [isSavingUserDefaults, setIsSavingUserDefaults] = useState(false)
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(false)
  const [isLoadingUserDefaults, setIsLoadingUserDefaults] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [showPushConfirm, setShowPushConfirm] = useState(false)

  // Editing state
  const [editingColumn, setEditingColumn] = useState<EditingColumn | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [deletingColumn, setDeletingColumn] = useState<FileMetadataColumn | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Select options editing
  const [newOption, setNewOption] = useState('')

  const handleSaveUserDefaults = async () => {
    setIsSavingUserDefaults(true)
    const result = await saveUserColumnDefaults()
    setIsSavingUserDefaults(false)

    if (result.success) {
      addToast('success', t('settingsPages.metadata.personalDefaultsSaved'))
    } else {
      addToast('error', result.error || t('settingsPages.metadata.defaultsSaveFailed'))
    }
  }

  const handleLoadUserDefaults = async () => {
    setIsLoadingUserDefaults(true)
    const result = await loadUserColumnDefaults()
    setIsLoadingUserDefaults(false)

    if (result.success) {
      addToast('success', t('settingsPages.metadata.personalDefaultsLoaded'))
    } else {
      addToast('error', result.error || t('settingsPages.metadata.defaultsLoadFailed'))
    }
  }

  const handleSaveOrgDefaults = async () => {
    setIsSavingDefaults(true)
    const result = await saveOrgColumnDefaults()
    setIsSavingDefaults(false)

    if (result.success) {
      addToast('success', t('settingsPages.metadata.organizationDefaultsSaved'))
    } else {
      addToast('error', result.error || t('settingsPages.metadata.defaultsSaveFailed'))
    }
  }

  const handleLoadOrgDefaults = async () => {
    setIsLoadingDefaults(true)
    const result = await loadOrgColumnDefaults()
    setIsLoadingDefaults(false)

    if (result.success) {
      addToast('success', t('settingsPages.metadata.organizationDefaultsLoaded'))
    } else {
      addToast('error', result.error || t('settingsPages.metadata.defaultsLoadFailed'))
    }
  }

  const handleResetToDefaults = () => {
    resetColumnsToDefaults()
    addToast('info', t('settingsPages.metadata.applicationDefaultsRestored'))
  }

  // Handle force-push to all users
  const handlePushToAllUsers = async () => {
    setShowPushConfirm(false)
    setIsPushing(true)
    const result = await forceOrgColumnDefaults()
    setIsPushing(false)

    if (result.success) {
      addToast('success', t('settingsPages.metadata.layoutPushed'))
    } else {
      addToast('error', result.error || t('settingsPages.metadata.layoutPushFailed'))
    }
  }

  // Load columns
  useEffect(() => {
    if (organization) {
      loadColumns()
    }
  }, [organization])

  const loadColumns = async () => {
    if (!organization) return

    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('file_metadata_column')
        .select('*')
        .eq('org_id', organization.id)
        .order('sort_order')

      if (error) {
        log.error('[MetadataColumns]', 'Failed to load metadata columns', { error })
        addToast('error', translate('settingsPages.metadata.loadFailed'))
      } else {
        setColumns(data || [])
      }
    } catch (error) {
      log.error('[MetadataColumns]', 'Failed to load metadata columns', { error: error })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveColumn = async () => {
    if (!editingColumn || !organization || !user) return

    // Validate
    if (!editingColumn.name.trim()) {
      addToast('error', t('settingsPages.metadata.nameRequired'))
      return
    }
    if (!editingColumn.label.trim()) {
      addToast('error', t('settingsPages.metadata.labelRequired'))
      return
    }

    // Validate name format (only lowercase letters, numbers, underscores)
    const nameRegex = /^[a-z][a-z0-9_]*$/
    if (!nameRegex.test(editingColumn.name)) {
      addToast(
        'error',
        t('settingsPages.metadata.invalidName'),
      )
      return
    }

    setIsSaving(true)

    try {
      if (editingColumn.id) {
        // Update existing column
        const { error } = await db
          .from('file_metadata_column')
          .update({
            name: editingColumn.name.toLowerCase(),
            label: editingColumn.label,
            data_type: editingColumn.data_type,
            select_options: editingColumn.select_options,
            width: editingColumn.width,
            is_visible: editingColumn.visible,
            is_sortable: editingColumn.sortable,
            is_required: editingColumn.required,
            default_value: editingColumn.default_value || null,
            updated_at: new Date().toISOString(),
            updated_by: user.id,
          })
          .eq('id', editingColumn.id)

        if (error) throw error
        addToast('success', t('settingsPages.metadata.columnUpdated'))
      } else {
        // Create new column
        const maxSortOrder = columns.length > 0 ? Math.max(...columns.map((c) => c.sort_order)) : -1

        const { error } = await db.from('file_metadata_column').insert({
          org_id: organization.id,
          name: editingColumn.name.toLowerCase(),
          label: editingColumn.label,
          data_type: editingColumn.data_type,
          select_options: editingColumn.select_options,
          width: editingColumn.width,
          is_visible: editingColumn.visible,
          is_sortable: editingColumn.sortable,
          is_required: editingColumn.required,
          default_value: editingColumn.default_value || null,
          sort_order: maxSortOrder + 1,
          created_by: user.id,
        })

        if (error) throw error
        addToast('success', t('settingsPages.metadata.columnCreated'))
      }

      await loadColumns()
      setEditingColumn(null)
      setIsCreating(false)
    } catch (error: unknown) {
      log.error('[MetadataColumns]', 'Failed to save column', { error: error })
      const errorMessage = error instanceof Error ? error.message : t('settingsPages.export.unknownError')
      if (errorMessage.includes('duplicate key')) {
        addToast('error', t('settingsPages.metadata.duplicateName'))
      } else {
        addToast('error', t('settingsPages.metadata.columnSaveFailed'))
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteColumn = async () => {
    if (!deletingColumn) return

    setIsDeleting(true)
    try {
      const { error } = await supabase
        .from('file_metadata_column')
        .delete()
        .eq('id', deletingColumn.id)

      if (error) throw error

      addToast(
        'success',
        t('settingsPages.metadata.columnDeleted', { label: deletingColumn.label }),
      )
      await loadColumns()
      setDeletingColumn(null)
    } catch (error) {
      log.error('[MetadataColumns]', 'Failed to delete column', { error: error })
      addToast('error', t('settingsPages.metadata.columnDeleteFailed'))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleToggleVisibility = async (column: FileMetadataColumn) => {
    try {
      const { error } = await db
        .from('file_metadata_column')
        .update({ is_visible: !column.is_visible, updated_at: new Date().toISOString() })
        .eq('id', column.id)

      if (error) throw error

      setColumns(columns.map((c) => (c.id === column.id ? { ...c, is_visible: !c.is_visible } : c)))
    } catch (error) {
      log.error('[MetadataColumns]', 'Failed to toggle visibility', { error: error })
      addToast('error', t('settingsPages.metadata.columnUpdateFailed'))
    }
  }

  const handleMoveColumn = async (column: FileMetadataColumn, direction: 'up' | 'down') => {
    const index = columns.findIndex((c) => c.id === column.id)
    if (direction === 'up' && index === 0) return
    if (direction === 'down' && index === columns.length - 1) return

    const swapIndex = direction === 'up' ? index - 1 : index + 1
    const otherColumn = columns[swapIndex]

    try {
      // Swap sort orders
      await Promise.all([
        db
          .from('file_metadata_column')
          .update({ sort_order: otherColumn.sort_order })
          .eq('id', column.id),
        db
          .from('file_metadata_column')
          .update({ sort_order: column.sort_order })
          .eq('id', otherColumn.id),
      ])

      await loadColumns()
    } catch (error) {
      log.error('[MetadataColumns]', 'Failed to reorder columns', { error: error })
      addToast('error', t('settingsPages.metadata.reorderFailed'))
    }
  }

  const addSelectOption = () => {
    if (!newOption.trim() || !editingColumn) return

    if (editingColumn.select_options.includes(newOption.trim())) {
      addToast('error', t('settingsPages.metadata.optionExists'))
      return
    }

    setEditingColumn({
      ...editingColumn,
      select_options: [...editingColumn.select_options, newOption.trim()],
    })
    setNewOption('')
  }

  const removeSelectOption = (option: string) => {
    if (!editingColumn) return
    setEditingColumn({
      ...editingColumn,
      select_options: editingColumn.select_options.filter((o) => o !== option),
    })
  }

  const isAdmin = getEffectiveRole() === 'admin'

  return (
    <SettingsPage>
      <SettingsSection
        title={t('settingsPages.metadata.builtInColumns')}
        description={`${t('settingsPages.metadata.standardColumns')} ${
          isAdmin
            ? t('settingsPages.metadata.adminBuiltInHelp')
              : t('settingsPages.metadata.memberBuiltInHelp')
        }`}
      >
        <SettingsGroup>
          <div className={`grid grid-cols-[1fr_96px_64px] items-center gap-2 ${TABLE_HEAD}`}>
            <span>{t('settingsPages.metadata.column')}</span>
            <span className="text-center">{t('settingsPages.metadata.width')}</span>
            <span className="text-center">{t('settingsPages.metadata.visible')}</span>
          </div>
          {builtinColumns.map((column) => (
            <div key={column.id} className="grid grid-cols-[1fr_96px_64px] items-center gap-2 py-3">
              <span
                className={`truncate text-[14px] ${column.visible ? 'text-ui-fg' : 'text-ui-fg-secondary'}`}
              >
                {column.label}
              </span>
              {isAdmin ? (
                <TextInput
                  type="number"
                  size="sm"
                  value={column.width}
                  onChange={(e) =>
                    setColumnWidth(column.id, Math.max(40, parseInt(e.target.value) || 40))
                  }
                  className="text-center"
                  min={40}
                  max={500}
                  aria-label={`${column.label} width`}
                />
              ) : (
                <span className="text-center text-[13px] text-ui-fg-secondary">
                  {column.width}px
                </span>
              )}
              <div className="flex justify-center">
                <Switch
                  size="sm"
                  checked={column.visible}
                  onChange={() => toggleColumnVisibility(column.id)}
                  title={column.visible ? t('settingsPages.metadata.hideColumn') : t('settingsPages.metadata.showColumn')}
                  aria-label={column.visible ? t('settingsPages.metadata.hideColumn') : t('settingsPages.metadata.showColumn')}
                />
              </div>
            </div>
          ))}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title={t('settingsPages.metadata.customColumns')}
        description={
          isAdmin
                  ? t('settingsPages.metadata.adminCustomHelp')
                  : t('settingsPages.metadata.memberCustomHelp')
        }
        actions={
          isAdmin &&
          !isCreating &&
          !editingColumn &&
          organization && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => {
                setEditingColumn({ ...DEFAULT_COLUMN })
                setIsCreating(true)
              }}
            >
              {t('settingsPages.metadata.addColumn')}
            </Button>
          )
        }
      >
        {isAdmin && editingColumn && (
          <MetadataColumnEditor
            column={editingColumn}
            onChange={setEditingColumn}
            isCreating={isCreating}
            isSaving={isSaving}
            newOption={newOption}
            onNewOptionChange={setNewOption}
            onAddOption={addSelectOption}
            onRemoveOption={removeSelectOption}
            onCancel={() => {
              setEditingColumn(null)
              setIsCreating(false)
            }}
            onSave={handleSaveColumn}
          />
        )}

        {!organization ? (
          <SettingsGroup>
            <p className="py-4 text-[14px] text-ui-fg-secondary">
              {t('settingsPages.metadata.connectOrganization')}
            </p>
          </SettingsGroup>
        ) : isLoading ? (
          <div className="flex items-center py-6">
            <Loader2 className="animate-spin text-ui-fg-secondary" size={20} />
          </div>
        ) : columns.length === 0 && !isCreating ? (
          <SettingsGroup>
            <div className="py-4">
              <p className="text-[14px] text-ui-fg-secondary">{t('settingsPages.metadata.noCustomColumns')}</p>
              {isAdmin && (
                <p className="mt-1 text-[13px] text-ui-fg-secondary">
                  {t('settingsPages.metadata.noCustomColumnsHelp')}
                </p>
              )}
            </div>
          </SettingsGroup>
        ) : columns.length > 0 ? (
          <SettingsGroup>
            <div
              className={`grid grid-cols-[1fr_80px_80px_64px_auto] items-center gap-2 ${TABLE_HEAD}`}
            >
              <span>{t('settingsPages.metadata.column')}</span>
              <span className="text-center">{t('settingsPages.metadata.type')}</span>
              <span className="text-center">{t('settingsPages.metadata.width')}</span>
              <span className="text-center">{t('settingsPages.metadata.visible')}</span>
              {isAdmin && <span className="w-16 text-center">{t('settingsPages.metadata.actions')}</span>}
            </div>
            {columns.map((column, index) => (
              <div
                key={column.id}
                className="group grid grid-cols-[1fr_80px_80px_64px_auto] items-center gap-2 py-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {isAdmin && (
                    <div className="flex flex-col opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<ChevronUp size={12} />}
                        onClick={() => handleMoveColumn(column, 'up')}
                        disabled={index === 0}
                        className="!h-3.5 !rounded !px-0.5"
                        aria-label="Move up"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<ChevronDown size={12} />}
                        onClick={() => handleMoveColumn(column, 'down')}
                        disabled={index === columns.length - 1}
                        className="!h-3.5 !rounded !px-0.5"
                        aria-label="Move down"
                      />
                    </div>
                  )}
                  <span
                    className={`truncate text-[14px] ${column.is_visible ? 'text-ui-fg' : 'text-ui-fg-secondary'}`}
                  >
                    {column.label}
                  </span>
                  {column.is_required && <Badge>{t('settingsPages.metadata.required')}</Badge>}
                </div>
                <span className="text-center text-[13px] text-ui-fg-secondary">
                  {getMetadataColumnTypeLabel(column.data_type, t)}
                </span>
                <span className="text-center text-[13px] text-ui-fg-secondary">
                  {column.width}px
                </span>
                <div className="flex justify-center">
                  <Switch
                    size="sm"
                    checked={column.is_visible}
                    onChange={() => handleToggleVisibility(column)}
                    title={column.is_visible ? t('settingsPages.metadata.hideColumn') : t('settingsPages.metadata.showColumn')}
                    aria-label={column.is_visible ? t('settingsPages.metadata.hideColumn') : t('settingsPages.metadata.showColumn')}
                  />
                </div>
                {isAdmin && (
                  <div className="flex w-16 items-center justify-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Pencil size={13} />}
                      onClick={() => {
                        setEditingColumn({
                          id: column.id,
                          name: column.name,
                          label: column.label,
                          data_type: column.data_type,
                          select_options: column.select_options || [],
                          width: column.width,
                          visible: column.is_visible,
                          sortable: column.is_sortable,
                          required: column.is_required,
                          default_value: column.default_value || '',
                        })
                        setIsCreating(false)
                      }}
                      className="!px-1.5"
                      title="Edit column"
                      aria-label="Edit column"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 size={13} />}
                      onClick={() => setDeletingColumn(column)}
                      className="!px-1.5 !text-ui-danger"
                      title="Delete column"
                      aria-label="Delete column"
                    />
                  </div>
                )}
              </div>
            ))}
          </SettingsGroup>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Column layout">
        <SettingsGroup>
          {user && (
            <SettingRow
              label={t('settingsPages.metadata.yourLayout')}
              description={t('settingsPages.metadata.personalDefaultsHelp')}
            >
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveUserDefaults}
                disabled={isSavingUserDefaults}
              >
                {isSavingUserDefaults
                  ? t('settingsPages.metadata.saving')
                  : t('settingsPages.metadata.saveMyDefaults')}
              </Button>
              <Button size="sm" onClick={handleLoadUserDefaults} disabled={isLoadingUserDefaults}>
                {isLoadingUserDefaults ? t('settingsPages.metadata.loading') : t('settingsPages.metadata.loadMyDefaults')}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleResetToDefaults}>
                {t('settingsPages.metadata.resetAppDefaults')}
              </Button>
            </SettingRow>
          )}
          {organization && (
            <SettingRow
              label={t('settingsPages.metadata.organizationLayout')}
              description={
                isAdmin
                  ? t('settingsPages.metadata.organizationDefaultsHelp')
                  : undefined
              }
            >
              {isAdmin && (
                <Button size="sm" onClick={handleSaveOrgDefaults} disabled={isSavingDefaults}>
                  {isSavingDefaults
                    ? t('settingsPages.metadata.saving')
                    : t('settingsPages.metadata.saveOrgDefaults')}
                </Button>
              )}
              {isAdmin && (
                <Button
                  variant="danger-subtle"
                  size="sm"
                  icon={<Send size={14} />}
                  loading={isPushing}
                  onClick={() => setShowPushConfirm(true)}
                >
                  {isPushing
                    ? t('settingsPages.metadata.pushing')
                    : t('settingsPages.metadata.pushAllUsers')}
                </Button>
              )}
              <Button size="sm" onClick={handleLoadOrgDefaults} disabled={isLoadingDefaults}>
                {isLoadingDefaults ? t('settingsPages.metadata.loading') : t('settingsPages.metadata.loadOrgDefaults')}
              </Button>
            </SettingRow>
          )}
        </SettingsGroup>
      </SettingsSection>

      <MetadataColumnDialogs
        deletingColumn={deletingColumn}
        isDeleting={isDeleting}
        onCancelDelete={() => setDeletingColumn(null)}
        onConfirmDelete={handleDeleteColumn}
        showPushConfirm={showPushConfirm}
        onCancelPush={() => setShowPushConfirm(false)}
        onConfirmPush={handlePushToAllUsers}
      />
    </SettingsPage>
  )
}
