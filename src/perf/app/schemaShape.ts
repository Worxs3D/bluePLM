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

export function loadSchemaShape(): SchemaShape {
  if (cached) return cached
  cached = {
    tables: new Map(
      serialized.tables.map(([name, t]) => [
        name,
        { columns: new Set(t.columns), requiredOnInsert: new Set(t.requiredOnInsert) },
      ]),
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
