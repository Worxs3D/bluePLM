/**
 * Perf build stand-in for `src/test/supabaseSchema.ts`.
 *
 * The fake Supabase reads its table and RPC shapes by parsing `src/types/supabase.ts` with the
 * TypeScript compiler, which a renderer cannot load. The perf build parses the file at build time
 * (scripts/render-perf/perfBuildPlugin.ts) and this module rebuilds the same shape from it, so the
 * fake stays exactly as strict in the app as it is in the tests.
 */
import serialized from 'virtual:perf-schema-shape'

import type { SchemaShape } from '@/test/supabaseSchema'

let cached: SchemaShape | null = null

/**
 * Tables and columns the app already queries through an untyped client view because
 * `src/types/supabase.ts` predates their schema (504, 505). Added here, for the perf and ui-look
 * boots only, so the fake answers them; a table or column the generated types gain later is simply
 * merged. Drop an entry once `npm run gen:types` has it.
 */
const PENDING_TABLES: Record<string, { columns: string[]; requiredOnInsert: string[] }> = {
  // Schema 504 (+ sequence, 505).
  inspection_report: {
    columns: [
      'id', 'org_id', 'file_id', 'file_version_id', 'template_id', 'template_name', 'template_hash',
      'report_number', 'sequence', 'title', 'status', 'storage_hash', 'file_size',
      'characteristic_count', 'drawing_pdf_hash', 'returned_hash', 'returned_at', 'returned_by',
      'results', 'results_summary', 'notes', 'created_by', 'created_at', 'updated_by', 'updated_at',
      // Schema 506.
      'report_type', 'fai_scope', 'fai_reason', 'fai_baseline_version_id', 'lot_number', 'lot_size',
      'sampling', 'po_number', 'supplier_name', 'ncr_reference', 'characteristic_ids', 'sample_columns',
    ],
    requiredOnInsert: ['org_id', 'file_id', 'file_version_id', 'storage_hash', 'file_size'],
  },
  inspection_template: {
    columns: [
      'id', 'org_id', 'name', 'description', 'storage_hash', 'file_size', 'original_filename',
      'revision', 'is_default', 'layout', 'archived_at', 'created_by', 'created_at', 'updated_by',
      'updated_at',
      // Schema 506.
      'report_types', 'default_for',
    ],
    requiredOnInsert: ['org_id', 'name', 'storage_hash', 'file_size'],
  },
  inspection_characteristic: { columns: ['tolerance_source'], requiredOnInsert: [] },
  inspection_characteristic_version: { columns: ['tolerance_source'], requiredOnInsert: [] },
  // Schema 505.
  file_version_output: {
    columns: [
      'id', 'org_id', 'file_id', 'file_version_id', 'kind', 'configuration', 'storage_hash',
      'file_size', 'file_name', 'is_closure_exact', 'generated_by', 'generated_at',
    ],
    requiredOnInsert: ['org_id', 'file_id', 'file_version_id', 'kind', 'storage_hash', 'file_size'],
  },
}

type MutableTables = Map<string, { columns: Set<string>; requiredOnInsert: Set<string> }>

function withPendingTables(tables: MutableTables): MutableTables {
  for (const [name, pending] of Object.entries(PENDING_TABLES)) {
    const table = tables.get(name)
    if (table) {
      for (const column of pending.columns) table.columns.add(column)
    } else {
      tables.set(name, {
        columns: new Set(pending.columns),
        requiredOnInsert: new Set(pending.requiredOnInsert),
      })
    }
  }
  return tables
}

export function loadSchemaShape(): SchemaShape {
  if (cached) return cached
  cached = {
    tables: withPendingTables(
      new Map(
        serialized.tables.map(([name, t]) => [
          name,
          { columns: new Set(t.columns), requiredOnInsert: new Set(t.requiredOnInsert) },
        ]),
      ),
    ),
    functions: new Map(
      serialized.functions.map(([name, f]) => [
        name,
        { args: new Set(f.args), required: new Set(f.required) },
      ]),
    ),
  }
  return cached
}
