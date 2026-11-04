/**
 * Parse `src/types/supabase.ts` into the table and RPC shapes the fake Supabase enforces, and
 * write them where the perf build reads them (vite.perf.ts). Run before `vite build` with
 * BLUEPLM_PERF_BUILD=1: `npx tsx scripts/render-perf/emitSchemaShape.ts`.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { parseSchemaShape } from '../../src/test/supabaseSchema'

/** PERF_SCHEMA_SHAPE_FILE in vite.perf.ts (a different tsconfig project, so not importable here). */
const PERF_SCHEMA_SHAPE_FILE = process.env.BLUEPLM_PERF_OUT
  ? resolve(process.env.BLUEPLM_PERF_OUT, 'schema-shape.json')
  : 'node_modules/.cache/blueplm-perf/schema-shape.json'

const root = resolve(__dirname, '../..')
const shape = parseSchemaShape(readFileSync(resolve(root, 'src/types/supabase.ts'), 'utf8'))

// The generated types can lag the numbered migrations (they need the schema applied to
// regenerate), and the fake refuses columns it does not know. Add every column a migration adds
// with ALTER TABLE ... ADD COLUMN, so the boot reads what the released schema has (for example
// 509's file_version.released_at behind "Released as Rev B").
const migrations = resolve(root, 'supabase/migrations')
for (const name of readdirSync(migrations).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
  const sql = readFileSync(join(migrations, name), 'utf8')
  for (const statement of sql.matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?(\w+)([^;]*);/gi)) {
    const table = shape.tables.get(statement[1])
    if (!table) continue
    for (const column of statement[2].matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?(\w+)/gi)) {
      ;(table.columns as Set<string>).add(column[1])
    }
  }
}
const serialized = {
  tables: [...shape.tables].map(([name, t]) => [
    name,
    { columns: [...t.columns], requiredOnInsert: [...t.requiredOnInsert] },
  ]),
  functions: [...shape.functions].map(([name, f]) => [name, { args: [...f.args], required: [...f.required] }]),
}
const out = resolve(root, PERF_SCHEMA_SHAPE_FILE)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(serialized))
process.stdout.write(`[render-perf] schema shape: ${shape.tables.size} tables, ${shape.functions.size} functions -> ${out}\n`)
