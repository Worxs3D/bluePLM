/**
 * The supplier picker's options: the organization's active `supplier` rows (module 30), read
 * the same way the Supplier Database view reads them and kept in its store fields, so both
 * screens share one list.
 */

import { log } from '@/lib/logger'
import { supabase } from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'

/** Load the suppliers once per session (the Supplier Database view refreshes them too). */
export async function ensureSuppliersLoaded(orgId: string): Promise<void> {
  const s = usePDMStore.getState()
  if (s.suppliersLoaded || s.suppliersLoading) return
  s.setSuppliersLoading(true)
  try {
    const { data, error } = await supabase
      .from('supplier')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('name')
    if (error) throw error
    usePDMStore.getState().setSuppliers(data || [])
  } catch (error) {
    log.warn('[Orders]', 'Loading suppliers for the picker failed', { error })
  } finally {
    usePDMStore.getState().setSuppliersLoading(false)
  }
}
