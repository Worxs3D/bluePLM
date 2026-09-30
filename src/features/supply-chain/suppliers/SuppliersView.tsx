import { useState, useEffect, useCallback } from 'react'
import {
  Building2,
  Plus,
  Search,
  MapPin,
  RefreshCw,
  ExternalLink,
  Loader2,
  Clock,
  Globe,
  Mail,
  Phone,
  ChevronRight,
  Pencil,
  Trash2,
} from 'lucide-react'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import type { Supplier } from '@/stores/types'
import { supabase } from '@/lib/supabase'
import { createMdbSupplier, deactivateMdbSupplier, getMdbSuppliers, updateMdbSupplier } from '@/lib/mdb'
import { isMdbBackendActive } from '@/lib/backendAdapter'
import { t } from '@/lib/i18n'

function getApiUrl(organization: { settings?: { api_url?: string } } | null): string | null {
  return organization?.settings?.api_url || null
}

export function SuppliersView() {
  const {
    organization,
    addToast,
    setActiveView,
    // Suppliers slice state
    suppliers,
    suppliersLoading,
    suppliersLoaded,
    // Suppliers slice actions
    setSuppliers,
    setSuppliersLoading,
    getEffectiveRole,
  } = usePDMStore()

  // Local UI state (not persisted)
  const [syncing, setSyncing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'pending'>('all')
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [supplierEmail, setSupplierEmail] = useState('')
  const [supplierPhone, setSupplierPhone] = useState('')
  const [supplierCode, setSupplierCode] = useState('')
  const [supplierWebsite, setSupplierWebsite] = useState('')
  const [supplierCity, setSupplierCity] = useState('')
  const [supplierState, setSupplierState] = useState('')
  const [supplierCountry, setSupplierCountry] = useState('')
  const [supplierApproved, setSupplierApproved] = useState(false)
  const [saving, setSaving] = useState(false)
  const canManageSuppliers = ['owner', 'admin'].includes(getEffectiveRole())

  const openSupplierForm = (supplier: Supplier | null) => {
    setEditingSupplier(supplier)
    setSupplierName(supplier?.name ?? '')
    setSupplierEmail(supplier?.contact_email ?? '')
    setSupplierPhone(supplier?.contact_phone ?? '')
    setSupplierCode(supplier?.code ?? '')
    setSupplierWebsite(supplier?.website ?? '')
    setSupplierCity(supplier?.city ?? '')
    setSupplierState(supplier?.state ?? '')
    setSupplierCountry(supplier?.country ?? '')
    setSupplierApproved(supplier?.is_approved ?? false)
    setFormOpen(true)
  }

  const saveSupplier = async () => {
    if (!isMdbBackendActive() || !supplierName.trim() || !canManageSuppliers) return
    setSaving(true)
    try {
      if (supplierEmail.trim() && !/^\S+@\S+\.\S+$/.test(supplierEmail.trim())) {
        addToast('error', t('supplierManagement.saveFailed'))
        return
      }
      const input = { name: supplierName.trim(), code: supplierCode.trim() || null, contactEmail: supplierEmail.trim() || null, contactPhone: supplierPhone.trim() || null, website: supplierWebsite.trim() || null, city: supplierCity.trim() || null, state: supplierState.trim() || null, country: supplierCountry.trim() || null, isApproved: supplierApproved }
      const supplier = editingSupplier ? await updateMdbSupplier(editingSupplier.id, input) : await createMdbSupplier(input)
      setSuppliers(editingSupplier ? suppliers.map((item) => item.id === supplier.id ? supplier as Supplier : item) : [...suppliers, supplier as Supplier])
      setSelectedSupplier(supplier as Supplier)
      setFormOpen(false)
    } catch (error) {
      log.error('[Suppliers]', 'Failed to save supplier', { error })
      log.error('[Suppliers]', 'Supplier save failed', { error: error instanceof Error ? error.message : error })
      addToast('error', t('supplierManagement.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const deactivateSupplier = async (supplier: Supplier) => {
    if (!isMdbBackendActive() || !canManageSuppliers) return
    if (!window.confirm(t('supplierManagement.confirmDeactivate'))) return
    try {
      await deactivateMdbSupplier(supplier.id)
      setSuppliers(suppliers.filter((item) => item.id !== supplier.id))
      setSelectedSupplier(null)
    } catch (error) {
      log.error('[Suppliers]', 'Failed to deactivate supplier', { error })
      log.error('[Suppliers]', 'Supplier deactivation failed', { error: error instanceof Error ? error.message : error })
      addToast('error', t('supplierManagement.deactivateFailed'))
    }
  }

  const loadSuppliers = useCallback(async () => {
    if (!organization?.id) return

    setSuppliersLoading(true)

    try {
      if (isMdbBackendActive()) {
        setSuppliers((await getMdbSuppliers()) as Supplier[])
        return
      }
      const query = supabase
        .from('suppliers')
        .select('*')
        .eq('org_id', organization.id)
        .eq('is_active', true)
        .order('name')

      const { data, error } = await query

      if (error) throw error
      setSuppliers(data || [])
    } catch (error) {
      log.error('[Suppliers]', 'Failed to load suppliers', { error: error instanceof Error ? error.message : error })
      addToast('error', t('supplierManagement.loadFailed'))
    } finally {
      setSuppliersLoading(false)
    }
  }, [organization?.id, setSuppliers, setSuppliersLoading])

  // Load suppliers on mount if not already loaded
  useEffect(() => {
    if (!suppliersLoaded && organization?.id) {
      loadSuppliers()
    }
  }, [organization?.id, suppliersLoaded, loadSuppliers])

  const handleSync = async () => {
    setSyncing(true)

    try {
      if (isMdbBackendActive()) {
        addToast('warning', t('mdbSetup.erpSyncUnavailable'))
        return
      }
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token

      if (!token) {
        addToast('error', t('notConfigured'))
        setSyncing(false)
        return
      }

      const apiUrl = getApiUrl(organization)
      if (!apiUrl) {
        addToast('error', t('notConfigured'))
        setSyncing(false)
        return
      }
      const response = await fetch(`${apiUrl}/integrations/odoo/sync/suppliers`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await response.json()

      // Debug info available via log.debug
      log.debug('[Odoo Sync]', 'Sync response', { status: response.status, debug: data.debug })

      if (response.ok) {
        addToast('success', t('supplierManagement.syncFromOdoo'))
        loadSuppliers()
      } else {
        if (data.message?.includes('not configured')) {
          addToast(
            'warning',
            t('supplierManagement.syncFromOdoo'),
          )
          setActiveView('settings')
        } else {
          // Show more detailed error
          log.error('[Odoo Sync]', 'Supplier synchronization failed', { message: data.message, debug: data.debug })
          addToast('error', t('supplierManagement.loadFailed'))
        }
      }
    } catch (error) {
      log.error('[Odoo Sync]', 'Supplier synchronization threw', { error: error instanceof Error ? error.message : error })
      addToast('error', t('supplierManagement.loadFailed'))
    } finally {
      setSyncing(false)
    }
  }

  // Filter suppliers
  const filteredSuppliers = suppliers.filter((s) => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      if (
        !s.name.toLowerCase().includes(query) &&
        !s.code?.toLowerCase().includes(query) &&
        !s.city?.toLowerCase().includes(query)
      ) {
        return false
      }
    }

    // Status filter
    if (statusFilter === 'approved' && !s.is_approved) return false
    if (statusFilter === 'pending' && s.is_approved) return false

    return true
  })

  const approvedCount = suppliers.filter((s) => s.is_approved).length
  const pendingCount = suppliers.filter((s) => !s.is_approved).length
  const loading = suppliersLoading

  // Supplier detail view
  if (selectedSupplier) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b border-plm-border">
          <button
            onClick={() => setSelectedSupplier(null)}
            className="flex items-center gap-1 text-xs text-plm-fg-muted hover:text-plm-fg mb-3"
          >
            ← {t('supplierManagement.backToList')}
          </button>
          {canManageSuppliers && isMdbBackendActive() && (
            <div className="flex gap-2 mb-3">
              <button onClick={() => { openSupplierForm(selectedSupplier); setSelectedSupplier(null) }} className="btn btn-secondary gap-1">
                <Pencil size={14} /> {t('edit')}
              </button>
              <button onClick={() => void deactivateSupplier(selectedSupplier)} className="btn btn-secondary gap-1 text-plm-error">
                <Trash2 size={14} /> {t('delete')}
              </button>
            </div>
          )}
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-lg bg-plm-highlight flex items-center justify-center">
              <Building2 size={24} className="text-plm-fg-muted" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-medium text-plm-fg">{selectedSupplier.name}</h2>
              {selectedSupplier.code && (
                <span className="text-xs font-mono text-plm-fg-muted">{selectedSupplier.code}</span>
              )}
              <div className="flex gap-2 mt-2">
                <span
                  className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                    selectedSupplier.is_approved
                      ? 'bg-plm-success/20 text-plm-success'
                      : 'bg-plm-warning/20 text-plm-warning'
                  }`}
                >
                  {selectedSupplier.is_approved ? t('supplierManagement.approved') : t('supplierManagement.pending')}
                </span>
                {selectedSupplier.erp_id && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-plm-info/20 text-plm-info">
                    {t('supplierManagement.odoo')} #{selectedSupplier.erp_id}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Contact */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-plm-fg-muted uppercase tracking-wider">
              {t('supplierManagement.contact')}
            </h3>
            {selectedSupplier.contact_email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail size={14} className="text-plm-fg-muted" />
                <a
                  href={`mailto:${selectedSupplier.contact_email}`}
                  className="text-plm-accent hover:underline"
                >
                  {selectedSupplier.contact_email}
                </a>
              </div>
            )}
            {selectedSupplier.contact_phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone size={14} className="text-plm-fg-muted" />
                <span className="text-plm-fg">{selectedSupplier.contact_phone}</span>
              </div>
            )}
            {selectedSupplier.website && (
              <div className="flex items-center gap-2 text-sm">
                <Globe size={14} className="text-plm-fg-muted" />
                <a
                  href={
                    selectedSupplier.website.startsWith('http')
                      ? selectedSupplier.website
                      : `https://${selectedSupplier.website}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-plm-accent hover:underline flex items-center gap-1"
                >
                  {selectedSupplier.website}
                  <ExternalLink size={10} />
                </a>
              </div>
            )}
          </div>

          {/* Location */}
          {(selectedSupplier.city || selectedSupplier.state || selectedSupplier.country) && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-plm-fg-muted uppercase tracking-wider">
                {t('supplierManagement.location')}
              </h3>
              <div className="flex items-center gap-2 text-sm">
                <MapPin size={14} className="text-plm-fg-muted" />
                <span className="text-plm-fg">
                  {[selectedSupplier.city, selectedSupplier.state, selectedSupplier.country]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </div>
            </div>
          )}

          {/* Sync info */}
          {selectedSupplier.erp_synced_at && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-plm-fg-muted uppercase tracking-wider">
                {t('supplierManagement.sync')}
              </h3>
              <div className="flex items-center gap-2 text-sm">
                <Clock size={14} className="text-plm-fg-muted" />
                <span className="text-plm-fg-muted">
                  {t('supplierManagement.lastSynced', { date: new Date(selectedSupplier.erp_synced_at).toLocaleString() })}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-plm-border space-y-3">
        <div className="flex gap-2">
          {canManageSuppliers && isMdbBackendActive() && <button onClick={() => openSupplierForm(null)} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-plm-accent hover:bg-plm-accent/90 text-white rounded text-sm font-medium transition-colors">
            <Plus size={16} />
            {t('addSupplier')}
          </button>}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-plm-highlight hover:bg-plm-highlight/80 rounded text-sm font-medium text-plm-fg transition-colors disabled:opacity-50"
            title={t('supplierManagement.syncFromOdoo')}
          >
            {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('searchSuppliers')}
            className="w-full pl-9 pr-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted focus:outline-none focus:border-plm-accent"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex rounded bg-plm-input p-0.5">
          {(['all', 'approved', 'pending'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                statusFilter === filter
                  ? 'bg-plm-bg text-plm-fg shadow-sm'
                  : 'text-plm-fg-muted hover:text-plm-fg'
              }`}
            >
              {filter === 'all' && t('supplierManagement.all', { count: suppliers.length })}
              {filter === 'approved' && t('supplierManagement.approvedCount', { count: approvedCount })}
              {filter === 'pending' && t('supplierManagement.pendingCount', { count: pendingCount })}
            </button>
          ))}
        </div>
      </div>

      {/* Supplier List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={24} className="animate-spin text-plm-fg-muted" />
          </div>
        ) : filteredSuppliers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-plm-highlight flex items-center justify-center mb-3">
              <Building2 size={24} className="text-plm-fg-muted" />
            </div>
            {suppliers.length === 0 ? (
              <>
                <p className="text-sm text-plm-fg mb-1">{t('supplierManagement.noSuppliers')}</p>
                <p className="text-xs text-plm-fg-muted mb-4">{t('supplierManagement.syncOrAdd')}</p>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex items-center gap-2 px-3 py-2 bg-plm-accent hover:bg-plm-accent/90 text-white rounded text-sm font-medium transition-colors"
                >
                  <RefreshCw size={14} />
                  {t('supplierManagement.syncFromOdoo')}
                </button>
              </>
            ) : (
              <p className="text-sm text-plm-fg-muted">{t('supplierManagement.noSearchMatch')}</p>
            )}
          </div>
        ) : (
          filteredSuppliers.map((supplier) => (
            <button
              key={supplier.id}
              onClick={() => setSelectedSupplier(supplier)}
              className="w-full p-3 border-b border-plm-border hover:bg-plm-highlight/50 cursor-pointer transition-colors text-left group"
            >
              <div className="flex items-start justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded bg-plm-highlight flex items-center justify-center flex-shrink-0">
                    <Building2 size={14} className="text-plm-fg-muted" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-plm-fg truncate">{supplier.name}</div>
                    {supplier.code && (
                      <div className="text-[10px] font-mono text-plm-fg-muted">{supplier.code}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-1.5 py-0.5 text-[9px] font-medium rounded ${
                      supplier.is_approved
                        ? 'bg-plm-success/20 text-plm-success'
                        : 'bg-plm-warning/20 text-plm-warning'
                    }`}
                  >
                    {supplier.is_approved ? t('supplierManagement.approved') : t('supplierManagement.pending')}
                  </span>
                  <ChevronRight
                    size={14}
                    className="text-plm-fg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </div>
              </div>

              {(supplier.city || supplier.website) && (
                <div className="flex items-center gap-3 text-[11px] text-plm-fg-muted mt-1 ml-10">
                  {supplier.city && (
                    <span className="flex items-center gap-1">
                      <MapPin size={10} />
                      {supplier.city}
                      {supplier.state ? `, ${supplier.state}` : ''}
                    </span>
                  )}
                  {supplier.erp_id && (
                    <span className="flex items-center gap-1 text-plm-info">
                      <RefreshCw size={10} />
                      {t('supplierManagement.odoo')}
                    </span>
                  )}
                </div>
              )}
            </button>
          ))
        )}
      </div>

      {/* Footer stats */}
      {suppliers.length > 0 && (
        <div className="p-3 border-t border-plm-border bg-plm-bg">
          <div className="flex justify-between text-[11px] text-plm-fg-muted">
            <span>{t('supplierManagement.suppliersCount', { count: suppliers.length })}</span>
            <span>
              {t('supplierManagement.approvedPending', { approved: approvedCount, pending: pendingCount })}
            </span>
          </div>
        </div>
      )}
      {formOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" role="dialog">
          <div className="w-full max-w-md space-y-3 rounded-lg bg-plm-panel p-4">
            <h2 className="text-sm font-medium text-plm-fg">{editingSupplier ? t('edit') : t('addSupplier')}</h2>
            <input className="w-full input" value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder={t('name')} />
            <input className="w-full input" value={supplierCode} onChange={(event) => setSupplierCode(event.target.value)} placeholder={t('supplierManagement.code')} />
            <input className="w-full input" value={supplierEmail} onChange={(event) => setSupplierEmail(event.target.value)} placeholder={t('email')} />
            <input className="w-full input" value={supplierPhone} onChange={(event) => setSupplierPhone(event.target.value)} placeholder={t('phone')} />
            <input className="w-full input" value={supplierWebsite} onChange={(event) => setSupplierWebsite(event.target.value)} placeholder={t('supplierManagement.website')} />
            <div className="grid grid-cols-3 gap-2"><input className="input" value={supplierCity} onChange={(event) => setSupplierCity(event.target.value)} placeholder={t('supplierManagement.city')} /><input className="input" value={supplierState} onChange={(event) => setSupplierState(event.target.value)} placeholder={t('supplierManagement.state')} /><input className="input" value={supplierCountry} onChange={(event) => setSupplierCountry(event.target.value)} placeholder={t('supplierManagement.country')} /></div>
            <label className="flex items-center gap-2 text-xs text-plm-fg"><input type="checkbox" checked={supplierApproved} onChange={(event) => setSupplierApproved(event.target.checked)} />{t('supplierManagement.approved')}</label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setFormOpen(false)} className="btn btn-secondary">{t('cancel')}</button>
              <button onClick={() => void saveSupplier()} disabled={saving || !supplierName.trim()} className="btn btn-primary">{t('save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
