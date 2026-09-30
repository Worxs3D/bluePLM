import { describe, expect, it } from 'vitest'

import { mapMdbAuditFilesToScanRows } from './useVaultAudit'

describe('MDB vault audit rows', () => {
  it('maps the tenant-scoped MDB response into the scan without a Supabase read', () => {
    const rows = mapMdbAuditFilesToScanRows([{
      id: 'file-1', vaultId: 'vault-1', canonicalPath: 'Parts/widget.SLDPRT', fileName: 'widget.SLDPRT',
      currentRevision: 3, state: 'released', contentHash: 'hash', updatedAt: '2026-09-30T00:00:00Z',
      metadata: { part_number: 'PN-1', custom_properties: { _config_tabs: {} } },
    }])
    expect(rows).toEqual([expect.objectContaining({
      id: 'file-1', file_path: 'Parts/widget.SLDPRT', extension: '.sldprt',
      part_number: 'PN-1', custom_properties: { _config_tabs: {} },
    })])
  })
})
