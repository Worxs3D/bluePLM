/**
 * Inspection reports data layer: which snapshot a report of a version is built from, and content
 * downloads checked against their hash.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

let tables: Record<string, Row[]> = {}

/** An in-memory PostgREST query: eq / lt / in filters, order by one column, then the rows. */
function query(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  let orderBy: { column: string; ascending: boolean } | null = null
  const rows = () => {
    const out = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
    if (orderBy) {
      const { column, ascending } = orderBy
      out.sort((a, b) => (Number(a[column]) - Number(b[column])) * (ascending ? 1 : -1))
    }
    return out
  }
  const q = {
    select: () => q,
    eq(column: string, value: unknown) {
      filters.push((r) => r[column] === value)
      return q
    },
    lt(column: string, value: number) {
      filters.push((r) => Number(r[column]) < value)
      return q
    },
    in(column: string, values: unknown[]) {
      filters.push((r) => values.includes(r[column]))
      return q
    },
    order(column: string, opts: { ascending: boolean }) {
      orderBy ??= { column, ascending: opts.ascending }
      return q
    },
    async maybeSingle() {
      return { data: rows()[0] ?? null, error: null }
    },
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: rows(), error: null }).then(onFulfilled, onRejected)
    },
  }
  return q
}

let insertError: { message: string; code: string } | null = null
const insertQuery = () => ({
  select: () => ({ single: async () => ({ data: null, error: insertError }) }),
})

vi.mock('./client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => Object.assign(query(table), { insert: insertQuery }),
  }),
}))

const downloadFile = vi.fn()
vi.mock('@/lib/storage', () => ({
  hashFile: async (buffer: ArrayBuffer) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)))
      .map((x) => x.toString(16).padStart(2, '0'))
      .join(''),
  uploadFile: vi.fn(),
  downloadFile: (...a: unknown[]) => downloadFile(...a),
}))

const {
  createInspectionReport,
  downloadInspectionContent,
  getInspectionRowsAtVersion,
  InspectionReportNumberTakenError,
} = await import('./inspectionReports')

const version = (id: string, n: number, hash: string | null) => ({
  id,
  file_id: 'f',
  version: n,
  inspection_hash: hash,
})
const snap = (fileVersionId: string, balloon: string) => ({
  id: `${fileVersionId}-${balloon}`,
  file_version_id: fileVersionId,
  sort_order: Number(balloon),
  balloon_number: balloon,
  tolerance_source: 'general',
})

beforeEach(() => {
  tables = {
    file_version: [
      version('v1', 1, 'h1'),
      version('v2', 2, 'h2'),
      version('v3', 3, 'h3'),
      version('v4', 4, null),
    ],
    inspection_characteristic_version: [snap('v1', '1'), snap('v2', '1'), snap('v2', '2')],
  }
})

describe('getInspectionRowsAtVersion', () => {
  it("returns the version's own snapshot", async () => {
    const r = await getInspectionRowsAtVersion('f', 'v2')
    expect(r).toMatchObject({ exact: true, sourceFileVersionId: 'v2', sourceVersion: 2 })
    expect(r.rows.map((row) => row.balloon_number)).toEqual(['1', '2'])
    expect(r.rows[0].tolerance_source).toBe('general')
  })

  it('falls back to the newest older snapshot when the version has none', async () => {
    const r = await getInspectionRowsAtVersion('f', 'v3')
    expect(r).toMatchObject({ exact: false, sourceFileVersionId: 'v2', sourceVersion: 2 })
    expect(r.rows).toHaveLength(2)
  })

  it('returns no rows for a version that had no inspection table', async () => {
    const r = await getInspectionRowsAtVersion('f', 'v4')
    expect(r).toEqual({ rows: [], exact: true, sourceFileVersionId: 'v4', sourceVersion: 4 })
  })

  it('refuses a version of another file', async () => {
    await expect(getInspectionRowsAtVersion('other', 'v2')).rejects.toThrow(/not found/)
  })
})

describe('downloadInspectionContent', () => {
  const bytes = new TextEncoder().encode('workbook')
  const sha256 = async (b: Uint8Array) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(b))))
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')

  it('returns bytes that hash to the name', async () => {
    const hash = await sha256(bytes)
    downloadFile.mockResolvedValue({ data: new Blob([bytes]) })
    expect(Array.from(await downloadInspectionContent('org', hash))).toEqual(Array.from(bytes))
  })

  it('refuses bytes that do not', async () => {
    downloadFile.mockResolvedValue({ data: new Blob([bytes]) })
    await expect(downloadInspectionContent('org', 'a'.repeat(64))).rejects.toThrow(/does not match/)
  })
})

describe('createInspectionReport', () => {
  const input = {
    orgId: 'o',
    fileId: 'f',
    fileVersionId: 'v1',
    storageHash: 'a'.repeat(64),
    fileSize: 1,
    reportNumber: 'IR-0001',
  }

  it('reports a taken report number as REPORT_NUMBER_TAKEN', async () => {
    insertError = {
      code: '23505',
      message:
        'duplicate key value violates unique constraint "inspection_report_file_id_report_number_key"',
    }
    const err = await createInspectionReport(input).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(InspectionReportNumberTakenError)
    expect(err).toMatchObject({ code: 'REPORT_NUMBER_TAKEN', reportNumber: 'IR-0001' })
  })

  it('passes any other error through', async () => {
    insertError = { code: '42501', message: 'The report workbook was not uploaded by you' }
    const err = await createInspectionReport(input).catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(InspectionReportNumberTakenError)
    expect((err as Error).message).toMatch(/not uploaded by you/)
  })
})
