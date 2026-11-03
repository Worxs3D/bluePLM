import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Plus,
  Loader2,
  ClipboardList,
  Lock,
  Settings2,
  ScanSearch,
  CircleDot,
  FileSpreadsheet,
  Inbox,
  Table2,
  Filter,
  History,
  Zap,
  CircleCheck,
  CirclePause,
  RotateCw,
} from 'lucide-react'

import { ActionBar, Button, SegmentedControl, type ToolbarAction } from '@/components/core/ui'

import { t } from '@/lib/i18n'
import { usePDMStore, LocalFile } from '@/stores/pdmStore'
import {
  getInspectionRows,
  getInspectionRowsForVersion,
  saveInspectionRows,
  emptyRowValues,
  toRowInput,
  getFileVersions,
  type InspectionRowInput,
  type InspectionRowValues,
} from '@/lib/supabase'
import { log } from '@/lib/logger'
import { hasLocalContent } from '@/lib/fileOperations/assemblyResolver'
import {
  checkSwServiceFeature,
  SW_SERVICE_VERSION_INCREMENTAL_BALLOONS,
  SW_SERVICE_VERSION_NATIVE_INSPECTION,
} from '@/lib/swServiceVersion'

import { useSolidWorksService } from '../SolidWorksPanel'
import {
  BULK_EDIT_FIELDS,
  DEFAULT_INSPECTION_METHODS,
  isDrawingOwnedCell,
  resolveColumns,
  type BulkEditField,
} from './inspectionColumns'
import {
  applyBulkEdit,
  compareRows,
  matchesFilter,
  sortByBalloonAsc,
  toggleRowSelection,
  type SortDir,
} from './inspectionTableUtils'
import { MethodManagerModal } from './MethodManagerModal'
import { useDrawingCharacteristics } from './useDrawingCharacteristics'
import { useInspectionMethods } from './useInspectionMethods'
import { useAutoInspection, useDrawingSync } from './useDrawingSync'
import { autoBarState, type AutoBarState, isOffered, syncReasonKey } from './drawingSync'
import { InspectionTable } from './InspectionTable'
import { ColumnManager } from './ColumnManager'
import { BulkEditBar } from './BulkEditBar'
import { GoogleSheetTemplateMenu } from './GoogleSheetTemplateMenu'
import { InspectionReportsView } from './reports/InspectionReportsView'
import { ReceivedInspectionsView } from './reports/ReceivedInspectionsView'

interface InspectionTabProps {
  file: LocalFile
}

type AutoStatus = Extract<AutoBarState, { mode: 'auto' }>['status']

/** Label and tooltip of the Auto pill in each state. */
const AUTO_STATUS_KEYS: Record<AutoStatus, { label: string; title: string }> = {
  inSync: {
    label: 'source.inspection.autoStatusInSync',
    title: 'source.inspection.autoStatusTitleInSync',
  },
  checking: {
    label: 'source.inspection.autoStatusChecking',
    title: 'source.inspection.autoStatusTitleChecking',
  },
  syncing: {
    label: 'source.inspection.autoStatusSyncing',
    title: 'source.inspection.autoStatusTitleSyncing',
  },
  waiting: {
    label: 'source.inspection.autoStatusWaiting',
    title: 'source.inspection.autoStatusTitleWaiting',
  },
  paused: {
    label: 'source.inspection.autoStatusPaused',
    title: 'source.inspection.autoStatusTitlePaused',
  },
}

const AUTOSAVE_DELAY_MS = 1000

const CURRENT_VERSION = 'current'

type InspectionView = 'table' | 'reports' | 'received'

interface VersionOption {
  id: string
  version: number
}

/**
 * The Inspection tab of a drawing: the live table (editable while the drawing is checked out by
 * the user) or a version snapshot, with extraction and ballooning through the SOLIDWORKS service.
 * Rows extracted from the drawing keep their geometry read-only; manual rows are fully editable.
 */
export function InspectionTab({ file }: InspectionTabProps) {
  const user = usePDMStore((s) => s.user)
  const organization = usePDMStore((s) => s.organization)
  const addToast = usePDMStore((s) => s.addToast)
  const columnPrefs = usePDMStore((s) => s.inspectionColumnPrefs)
  const showFilters = usePDMStore((s) => s.inspectionShowFilters)
  const setShowFilters = usePDMStore((s) => s.setInspectionShowFilters)
  const autoSync = usePDMStore((s) => s.inspectionAutoSync)
  const setAutoSync = usePDMStore((s) => s.setInspectionAutoSync)

  const fileId = file.pdmData?.id
  const orgId = file.pdmData?.org_id ?? organization?.id
  const isCheckedOutByMe = !!user?.id && file.pdmData?.checked_out_by === user.id

  const [rows, setRows] = useState<InspectionRowInput[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [versions, setVersions] = useState<VersionOption[]>([])
  const [selectedVersion, setSelectedVersion] = useState<string>(CURRENT_VERSION)
  const [sortKey, setSortKey] = useState<keyof InspectionRowValues>('balloon_number')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [filters, setFilters] = useState<Partial<Record<keyof InspectionRowValues, string>>>({})
  const [methodModalOpen, setMethodModalOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [view, setView] = useState<InspectionView>('table')
  const [focusReportId, setFocusReportId] = useState<string | null>(null)
  const reportsFocus = usePDMStore((s) => s.inspectionReportsFocus)
  const clearReportsFocus = usePDMStore((s) => s.clearInspectionReportsFocus)
  const selectionAnchorRef = useRef<string | null>(null)
  const { status: swStatus } = useSolidWorksService()
  const methods = useInspectionMethods(orgId, user?.id)
  const { visible: columns } = useMemo(() => resolveColumns(columnPrefs), [columnPrefs])

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)
  // The file whose live rows are on screen; null while loading or when a version snapshot is
  // shown. `persist` writes only to this file, so rows never land on another file or version.
  const loadedForRef = useRef<string | null>(null)
  // Saves run one at a time: `saveInspectionRows` deletes then upserts, so an autosave of older
  // rows still in flight could otherwise delete rows a later save just added.
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve())

  const viewingCurrent = selectedVersion === CURRENT_VERSION
  const editable = viewingCurrent && isCheckedOutByMe
  const isDrawing = (file.extension?.toLowerCase() ?? '') === '.slddrw'

  // Org-configured Drive folder holding inspection sheet templates. When set, the
  // "Generate template" dropdown is available on drawings.
  const templateFolderId =
    (organization as { google_drive_inspection_template_folder_id?: string } | null)
      ?.google_drive_inspection_template_folder_id ?? ''
  const canGenerateTemplate = isDrawing && !!templateFolderId

  // Load version list for the history selector
  useEffect(() => {
    if (!fileId) return
    let cancelled = false
    getFileVersions(fileId)
      .then(({ versions: data, error }) => {
        if (cancelled) return
        if (error) {
          log.warn('[InspectionTab]', 'Failed to load versions', { error: error.message })
          return
        }
        const opts = (data ?? []).map((v) => ({ id: v.id as string, version: v.version as number }))
        setVersions(opts)
      })
      .catch((error) =>
        log.warn('[InspectionTab]', 'Versions load exception', { error: String(error) }),
      )
    return () => {
      cancelled = true
    }
  }, [fileId])

  // Reset to current view whenever the selected file changes
  useEffect(() => {
    setSelectedVersion(CURRENT_VERSION)
    // The Received view lists many drawings, so it stays open when another drawing is selected.
    setView((v) => (v === 'received' && isDrawing ? v : 'table'))
    setFocusReportId(null)
  }, [fileId, isDrawing])

  // "Show in Inspection tab" on a report row of the file list opens the Reports view
  useEffect(() => {
    if (!reportsFocus || !fileId || reportsFocus.fileId !== fileId) return
    setView('reports')
    setFocusReportId(reportsFocus.reportId)
    clearReportsFocus()
  }, [reportsFocus, fileId, clearReportsFocus])

  // A selection belongs to the table it was made in
  useEffect(() => {
    setSelectedIds(new Set())
    selectionAnchorRef.current = null
  }, [fileId, selectedVersion])

  // Load rows for the active view (current live rows, or a version snapshot)
  useEffect(() => {
    if (!fileId) return
    let cancelled = false
    setIsLoading(true)
    loadedForRef.current = null

    const loader = viewingCurrent
      ? getInspectionRows(fileId)
      : getInspectionRowsForVersion(selectedVersion)

    loader
      .then((result) => {
        if (cancelled) return
        if (!result.success) {
          addToast('error', result.error || t('common.error'))
          setRows([])
          return
        }
        const mapped = (result.rows ?? []).map((r) => toRowInput(r))
        const sorted = sortByBalloonAsc(mapped)
        setRows(sorted)
        dirtyRef.current = false
        loadedForRef.current = viewingCurrent ? fileId : null
      })
      .catch((error) => {
        if (cancelled) return
        log.error('[InspectionTab]', 'Load failed', { error: String(error) })
        setRows([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [fileId, selectedVersion, viewingCurrent, addToast])

  const persist = useCallback(
    (rowsToSave: InspectionRowInput[]): Promise<boolean> => {
      // Only the live rows of the file they were loaded for, while it is checked out by me.
      // Decided now, not when the queued save runs: a file switch's cleanup flushes through
      // here, and the next load resets `loadedForRef` before the chained save gets its turn.
      const allowed = viewingCurrent && isCheckedOutByMe && loadedForRef.current === fileId
      const loadedFor = loadedForRef.current
      const save = async (): Promise<boolean> => {
        if (!fileId || !orgId || !user?.id) return false
        if (!allowed) {
          log.warn('[InspectionTab]', 'Save refused: rows are not the editable live table', {
            fileId,
            loadedFor,
          })
          return false
        }
        setIsSaving(true)
        try {
          const ordered = rowsToSave.map((row, index) => ({ ...row, sort_order: index }))
          const result = await saveInspectionRows(fileId, orgId, user.id, ordered)
          if (!result.success) {
            addToast('error', result.error || t('common.error'))
            return false
          }
          dirtyRef.current = false
          return true
        } catch (error) {
          log.error('[InspectionTab]', 'Save failed', { error: String(error) })
          addToast('error', t('common.error'))
          return false
        } finally {
          setIsSaving(false)
        }
      }
      const run = saveChainRef.current.then(save)
      saveChainRef.current = run.catch(() => undefined)
      return run
    },
    [fileId, orgId, user?.id, viewingCurrent, isCheckedOutByMe, addToast],
  )

  // Debounced autosave when edits are pending
  const scheduleSave = useCallback(
    (nextRows: InspectionRowInput[]) => {
      dirtyRef.current = true
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        void persist(nextRows)
      }, AUTOSAVE_DELAY_MS)
    },
    [persist],
  )

  // Latest rows for the drawing flows, which read the table after awaiting the service.
  const rowsRef = useRef<InspectionRowInput[]>(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])
  const getRows = useCallback(() => rowsRef.current, [])

  // Write a debounced edit now, so the drawing flows plan against what is saved.
  const flushPendingSave = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    return persist(rowsRef.current)
  }, [persist])

  // Extraction replaced the table: show the merged rows and save them.
  // A failed save puts the previous rows back and says so: the table never shows unsaved merged
  // rows as if they were stored.
  const commitMergedRows = useCallback(
    async (next: InspectionRowInput[]): Promise<boolean> => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = null
      const previous = rowsRef.current
      rowsRef.current = next
      setRows(next)
      const saved = await persist(next)
      if (!saved) {
        if (rowsRef.current === next) {
          rowsRef.current = previous
          setRows(previous)
        }
        addToast('error', t('source.inspection.mergeNotSaved'))
      }
      return saved
    },
    [persist, addToast],
  )

  // Leaving a file or version writes its pending edit first, while `persist` still belongs to it.
  useEffect(() => {
    return () => {
      if (!dirtyRef.current) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = null
      void persist(rowsRef.current)
    }
  }, [fileId, selectedVersion, persist])

  const drawingSync = useDrawingSync({
    file,
    fileId,
    enabled: editable && isDrawing,
    serviceVersion: swStatus.version,
  })

  const drawing = useDrawingCharacteristics({
    file,
    fileId,
    version: selectedVersion,
    enabled: editable && isDrawing,
    serviceRunning: swStatus.running,
    serviceVersion: swStatus.version,
    getRows,
    flushPendingSave,
    commitMergedRows,
    sync: drawingSync.recorder,
  })

  // Auto runs only where a click would: the service is up and new enough, the file is here.
  const autoReady =
    swStatus.running &&
    checkSwServiceFeature(swStatus.version ?? null, SW_SERVICE_VERSION_NATIVE_INSPECTION).status !==
      'incompatible' &&
    hasLocalContent(file)
  const hasLinkedRows = useMemo(() => rows.some((r) => !!r.source_key?.trim()), [rows])
  const auto = useAutoInspection({
    file,
    fileId,
    autoEnabled: autoSync,
    editable: editable && isDrawing && !isLoading,
    hasLinkedRows,
    ready: autoReady,
    serviceVersion: swStatus.version,
    isInFlight: drawing.isInFlight,
    recorder: drawingSync.recorder,
    runBalloon: drawing.handleBalloon,
    // A known service that keeps balloons; an unknown or older one would replace them all.
    catchUp:
      !!swStatus.version &&
      checkSwServiceFeature(swStatus.version, SW_SERVICE_VERSION_INCREMENTAL_BALLOONS).status !==
        'incompatible',
  })

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  const updateRows = useCallback(
    (updater: (prev: InspectionRowInput[]) => InspectionRowInput[]) => {
      setRows((prev) => {
        const next = updater(prev)
        scheduleSave(next)
        return next
      })
    },
    [scheduleSave],
  )

  const handleCellChange = useCallback(
    (rowId: string, key: keyof InspectionRowValues, value: string | number | boolean | null) => {
      updateRows((prev) =>
        prev.map((r) =>
          // The drawing owns an extracted row's geometry; the cell is read-only, and so is this.
          r.id === rowId && !isDrawingOwnedCell(r, key) ? { ...r, [key]: value } : r,
        ),
      )
    },
    [updateRows],
  )

  const handleAddRow = useCallback(() => {
    updateRows((prev) => [...prev, { ...emptyRowValues(prev.length), id: crypto.randomUUID() }])
  }, [updateRows])

  // Only manual rows can be deleted; an extracted row goes when its annotation does.
  const handleDeleteRow = useCallback(
    (rowId: string) => {
      updateRows((prev) => prev.filter((r) => r.id !== rowId || !!r.source_key?.trim()))
      setSelectedIds((prev) => {
        if (!prev.has(rowId)) return prev
        const next = new Set(prev)
        next.delete(rowId)
        return next
      })
    },
    [updateRows],
  )

  // Clicking a header toggles direction on the active column, or sorts a new column ascending.
  const handleSort = useCallback((key: keyof InspectionRowValues) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prevKey
      }
      setSortDir('asc')
      return key
    })
  }, [])

  const handleFilterChange = useCallback((key: keyof InspectionRowValues, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  // Hiding the filter row clears it: a hidden filter would hide rows (and keep bulk edits off
  // them) with nothing on screen saying so.
  const toggleFilters = useCallback(() => {
    if (showFilters) setFilters({})
    setShowFilters(!showFilters)
  }, [showFilters, setShowFilters])

  // Display view = base rows filtered on the shown columns, then sorted by the active column.
  const displayRows = useMemo(() => {
    const sortCol = columns.find((c) => c.key === sortKey)
    const sortType = sortCol?.type ?? 'text'
    const filtered = showFilters
      ? rows.filter((row) =>
          columns.every((col) => matchesFilter(row, col.key, filters[col.key] ?? '', col.type)),
        )
      : rows
    return [...filtered].sort((a, b) => compareRows(a, b, sortKey, sortDir, sortType))
  }, [rows, columns, filters, showFilters, sortKey, sortDir])

  // Selected rows still shown; bulk edits never reach a row the filters hide.
  const shownSelection = useMemo(
    () => new Set(displayRows.filter((r) => selectedIds.has(r.id)).map((r) => r.id)),
    [displayRows, selectedIds],
  )

  const handleToggleSelect = useCallback(
    (rowId: string, range: boolean) => {
      const anchor = selectionAnchorRef.current
      const shownIds = displayRows.map((r) => r.id)
      setSelectedIds((prev) => toggleRowSelection(prev, shownIds, rowId, anchor, range))
      selectionAnchorRef.current = rowId
    },
    [displayRows],
  )

  const handleSelectAll = useCallback(
    (select: boolean) => {
      setSelectedIds(select ? new Set(displayRows.map((r) => r.id)) : new Set())
      selectionAnchorRef.current = null
    },
    [displayRows],
  )

  const handleBulkApply = useCallback(
    (field: BulkEditField, value: string | number | null) => {
      const ids = shownSelection
      if (ids.size === 0) return
      updateRows((prev) => applyBulkEdit(prev, ids, field, value, BULK_EDIT_FIELDS))
      addToast('success', t('source.inspection.bulkApplied', { count: ids.size }))
    },
    [shownSelection, updateRows, addToast],
  )

  if (!fileId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-plm-fg/60 p-6 text-center">
        <ClipboardList size={28} className="mb-2 opacity-60" />
        <div className="text-sm">{t('source.inspection.notSynced')}</div>
      </div>
    )
  }

  const extractOffered = isOffered(drawingSync.status.extract)
  const balloonOffered = isOffered(drawingSync.status.balloon)
  const bar = autoBarState({
    autoEnabled: autoSync,
    hasLinkedRows,
    busy: drawing.busy,
    ready: autoReady,
    // Paused only while the drawing still has the content Auto failed on.
    paused: auto.failedHash !== null && auto.failedHash === drawingSync.currentHash,
    balloon: drawingSync.status.balloon,
  })
  const autoToggle: ToolbarAction = {
    id: 'auto',
    label: t('source.inspection.autoLabel'),
    icon: <Zap size={13} />,
    onClick: () => setAutoSync(!autoSync),
    pressed: autoSync,
    title: t(autoSync ? 'source.inspection.autoTitleOn' : 'source.inspection.autoTitleOff'),
  }

  // Actions in priority order: what fits stays in the bar, the rest goes in the More menu.
  const actions: ToolbarAction[] = []
  if (editable && isDrawing && bar.mode === 'auto') {
    // Auto owns the drawing: no Extract or Balloon to press, the pill says where it stands.
    const status = bar.status
    actions.push({
      ...autoToggle,
      label: t(AUTO_STATUS_KEYS[status].label),
      icon:
        status === 'inSync' ? (
          <CircleCheck size={13} />
        ) : status === 'paused' ? (
          <CirclePause size={13} />
        ) : (
          <Zap size={13} />
        ),
      loading: status === 'syncing' || status === 'checking',
      title: `${t(AUTO_STATUS_KEYS[status].title)} ${t('source.inspection.autoTitleOn')}`,
    })
    if (status === 'paused') {
      actions.push({
        id: 'autoRetry',
        label: t('source.inspection.autoRetry'),
        icon: <RotateCw size={13} />,
        onClick: auto.retry,
        primary: true,
      })
    }
  } else if (editable && isDrawing && bar.mode === 'start') {
    // Auto takes over once the table has been read from the drawing; the first read is a click.
    actions.push({
      id: 'start',
      label: drawing.busy ? t('source.inspection.ballooning') : t('source.inspection.autoStart'),
      icon: <ScanSearch size={13} />,
      onClick: () => void drawing.handleBalloon(),
      disabled: drawing.busy,
      loading: drawing.busy,
      title: t('source.inspection.autoStartTitle'),
      primary: !drawing.busy,
    })
    actions.push(autoToggle)
  } else if (editable && isDrawing) {
    actions.push({
      id: 'extract',
      label: drawing.isExtracting
        ? t('source.inspection.extracting')
        : t('source.inspection.extractFromDrawing'),
      icon: <ScanSearch size={13} />,
      onClick: () => void drawing.handleExtract(),
      disabled: drawing.busy || !extractOffered,
      loading: drawing.isExtracting,
      title: t(syncReasonKey('extract', drawingSync.status.extract)),
      // The drawing changed since the table was read from it: extracting is the next step.
      primary: extractOffered && !drawing.busy && rows.length > 0,
    })
    if (rows.length > 0) {
      actions.push({
        id: 'balloon',
        label: drawing.isBallooning
          ? t('source.inspection.ballooning')
          : t('source.inspection.balloonDrawing'),
        icon: <CircleDot size={13} />,
        onClick: () => void drawing.handleBalloon(),
        disabled: drawing.busy || !balloonOffered,
        loading: drawing.isBallooning,
        title: t(syncReasonKey('balloon', drawingSync.status.balloon)),
      })
    }
    actions.push(autoToggle)
  }
  if (editable) {
    actions.push({
      id: 'add',
      label: t('source.inspection.addRow'),
      icon: <Plus size={13} />,
      onClick: handleAddRow,
    })
  }
  if (rows.length > 0) {
    actions.push({
      id: 'filters',
      label: t('source.inspection.filterToggle'),
      icon: <Filter size={13} />,
      onClick: toggleFilters,
      pressed: showFilters,
      title: t(
        showFilters ? 'source.inspection.filterHideTitle' : 'source.inspection.filterShowTitle',
      ),
    })
  }
  if (editable) {
    actions.push({
      id: 'methods',
      label: t('source.inspection.methods'),
      icon: <Settings2 size={13} />,
      onClick: () => setMethodModalOpen(true),
      title: t('source.inspection.manageMethods'),
    })
  }

  const viewSwitch = isDrawing ? (
    <SegmentedControl<InspectionView>
      size="sm"
      value={view}
      onChange={setView}
      aria-label={t('source.inspection.rptViewSwitch')}
      options={[
        {
          value: 'table',
          label: t('source.inspection.rptViewTable'),
          icon: <Table2 size={12} />,
        },
        {
          value: 'reports',
          label: t('source.inspection.rptViewReports'),
          icon: <FileSpreadsheet size={12} />,
        },
        {
          value: 'received',
          label: t('source.inspection.rptViewReceived'),
          icon: <Inbox size={12} />,
        },
      ]}
    />
  ) : null

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar: one line at any width. View and version on the left, actions on the right. */}
      {view === 'table' && (
        <div className="flex h-11 min-w-0 shrink-0 items-center gap-2 border-b border-plm-border px-3">
          {viewSwitch}

          {view === 'table' && (
            <>
              <label
                className="flex shrink-0 items-center gap-1.5 text-[12px] text-ui-fg-secondary"
                title={t('source.inspection.version')}
              >
                <History size={13} aria-hidden />
                <span className="sr-only">{t('source.inspection.version')}</span>
                <select
                  value={selectedVersion}
                  onChange={(e) => setSelectedVersion(e.target.value)}
                  className="h-7 rounded-md border border-ui-field-border bg-ui-field py-0 pl-1.5 pr-1 text-[12px] leading-[26px] text-ui-fg"
                >
                  <option value={CURRENT_VERSION}>{t('source.inspection.current')}</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {t('source.inspection.versionOption', { version: v.version })}
                    </option>
                  ))}
                </select>
              </label>

              {isSaving && (
                <span className="flex shrink-0 items-center gap-1 text-[12px] text-ui-fg-secondary">
                  <Loader2 size={12} className="animate-spin" />
                  {t('source.inspection.saving')}
                </span>
              )}

              {!editable && (
                <span
                  className="flex min-w-0 items-center gap-1 rounded-md bg-ui-field px-1.5 py-0.5 text-[12px] text-ui-fg-secondary"
                  title={
                    viewingCurrent
                      ? t('source.inspection.readOnlyCheckout')
                      : t('source.inspection.readOnlySnapshot')
                  }
                >
                  <Lock size={11} className="shrink-0" />
                  <span className="truncate">
                    {viewingCurrent
                      ? t('source.inspection.readOnlyShort')
                      : t('source.inspection.snapshotShort')}
                  </span>
                </span>
              )}

              <ActionBar actions={actions} moreLabel={t('source.inspection.moreActions')} />

              {canGenerateTemplate && (
                <GoogleSheetTemplateMenu
                  file={file}
                  fileId={fileId}
                  orgId={orgId}
                  templateFolderId={templateFolderId}
                  rows={displayRows}
                />
              )}

              <ColumnManager />
            </>
          )}
        </div>
      )}

      {view === 'reports' ? (
        <div className="flex-1 overflow-hidden">
          <InspectionReportsView file={file} focusReportId={focusReportId} leading={viewSwitch} />
        </div>
      ) : view === 'received' ? (
        <div className="flex-1 overflow-hidden">
          <ReceivedInspectionsView file={file} leading={viewSwitch} />
        </div>
      ) : (
        <>
          {editable && shownSelection.size > 0 && (
            <BulkEditBar
              count={shownSelection.size}
              methodOptions={methods.methodOptions}
              onManageMethods={() => setMethodModalOpen(true)}
              onApply={handleBulkApply}
              onClear={() => handleSelectAll(false)}
            />
          )}

          {/* Table view (the toolbar's Table | Reports switch chooses this body) */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32 text-plm-fg/60">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-ui-field text-ui-fg-secondary">
                  <ClipboardList size={18} />
                </div>
                <div className="text-[13px] font-medium text-ui-fg">
                  {t('source.inspection.emptyTitle')}
                </div>
                <div className="max-w-sm text-[12px] leading-5 text-ui-fg-secondary">
                  {editable && isDrawing
                    ? t('source.inspection.emptyBodyEditable')
                    : viewingCurrent
                      ? t('source.inspection.emptyBodyReadOnly')
                      : t('source.inspection.emptyBodySnapshot')}
                </div>
                {editable && (
                  <div className="mt-2 flex items-center gap-2">
                    {isDrawing && bar.mode === 'start' && (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<ScanSearch size={13} />}
                        loading={drawing.busy}
                        disabled={drawing.busy}
                        title={t('source.inspection.autoStartTitle')}
                        onClick={() => void drawing.handleBalloon()}
                      >
                        {t('source.inspection.autoStart')}
                      </Button>
                    )}
                    {isDrawing && bar.mode === 'manual' && (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<ScanSearch size={13} />}
                        loading={drawing.isExtracting}
                        disabled={drawing.busy || !extractOffered}
                        title={t(syncReasonKey('extract', drawingSync.status.extract))}
                        onClick={() => void drawing.handleExtract()}
                      >
                        {t('source.inspection.extractFromDrawing')}
                      </Button>
                    )}
                    <Button size="sm" icon={<Plus size={13} />} onClick={handleAddRow}>
                      {t('source.inspection.addManualRow')}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <InspectionTable
                columns={columns}
                rows={displayRows}
                editable={editable}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                showFilters={showFilters}
                filters={filters}
                onFilterChange={handleFilterChange}
                onCellChange={handleCellChange}
                onDeleteRow={handleDeleteRow}
                methodOptions={methods.methodOptions}
                onManageMethods={() => setMethodModalOpen(true)}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onSelectAll={handleSelectAll}
                generalBasis={drawing.generalBasis}
              />
            )}
          </div>
        </>
      )}

      {methodModalOpen && (
        <MethodManagerModal
          methods={methods.orgMethods}
          builtInMethods={DEFAULT_INSPECTION_METHODS}
          onAdd={methods.addMethod}
          onRename={methods.renameMethod}
          onRemove={methods.removeMethod}
          onClose={() => setMethodModalOpen(false)}
        />
      )}
    </div>
  )
}
