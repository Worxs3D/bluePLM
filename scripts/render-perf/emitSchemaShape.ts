/**
 * Parse `src/types/supabase.ts` into the table and RPC shapes the fake Supabase enforces, and
 * write them where the perf build reads them (vite.perf.ts). Run before `vite build` with
 * BLUEPLM_PERF_BUILD=1: `npx tsx scripts/render-perf/emitSchemaShape.ts`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { parseSchemaShape } from '../../src/test/supabaseSchema'

/** PERF_SCHEMA_SHAPE_FILE in vite.perf.ts (a different tsconfig project, so not importable here). */
const PERF_SCHEMA_SHAPE_FILE = 'node_modules/.cache/blueplm-perf/schema-shape.json'

const root = resolve(__dirname, '../..')
const shape = parseSchemaShape(readFileSync(resolve(root, 'src/types/supabase.ts'), 'utf8'))
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
