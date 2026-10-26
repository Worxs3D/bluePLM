/**
 * Vite plugin for the render-performance build (BLUEPLM_PERF_BUILD=1, vite.config.ts). Never part
 * of a release build.
 *
 * - Every import of `src/lib/supabase/client.ts` resolves to `src/perf/app/supabaseClient.ts`,
 *   so the app's Supabase calls reach the fake backend. Relative imports are caught too, because
 *   the redirect matches the resolved file, not the specifier.
 * - The fake Supabase's schema reader (`src/test/supabaseSchema.ts`, which needs fs and the
 *   compiler) resolves to `src/perf/app/schemaShape.ts`, fed by `virtual:perf-schema-shape`:
 *   the same shape, parsed before the build by scripts/render-perf/emitSchemaShape.ts.
 * - `node:crypto` inside the test kit's fake disk is replaced by a small hash shim.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { normalizePath, type Plugin } from 'vite'

/** Written by `npx tsx scripts/render-perf/emitSchemaShape.ts`. */
export const PERF_SCHEMA_SHAPE_FILE = 'node_modules/.cache/blueplm-perf/schema-shape.json'

const VIRTUAL_SCHEMA = 'virtual:perf-schema-shape'
const RESOLVED_SCHEMA = '\0perf-schema-shape'

const norm = (path: string) => path.replace(/\\/g, '/').replace(/\?.*$/, '').toLowerCase()

export function perfBuildPlugin(root: string): Plugin {
  // Vite ids use forward slashes: a backslash id would load a second copy of the same module.
  const at = (path: string) => normalizePath(resolve(root, path))
  const redirects = new Map([
    [norm(at('src/lib/supabase/client.ts')), at('src/perf/app/supabaseClient.ts')],
    [norm(at('src/test/supabaseSchema.ts')), at('src/perf/app/schemaShape.ts')],
  ])
  const fakeDisk = norm(at('src/test/fakeElectron.ts'))

  return {
    name: 'blueplm-perf-build',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source === VIRTUAL_SCHEMA) return RESOLVED_SCHEMA
      if (source.startsWith('\0') || !importer) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved) return null
      return redirects.get(norm(resolved.id)) ?? null
    },
    // vite-plugin-electron-renderer aliases Node builtins to `require()` before any resolveId
    // runs, so the fake disk's import is rewritten in its source instead.
    transform(code, id) {
      if (norm(id) !== fakeDisk) return null
      const shim = at('src/perf/app/cryptoShim.ts')
      return code.replace("from 'node:crypto'", `from '${shim}'`)
    },
    load(id) {
      if (id !== RESOLVED_SCHEMA) return null
      const file = at(PERF_SCHEMA_SHAPE_FILE)
      if (!existsSync(file)) {
        throw new Error(`${PERF_SCHEMA_SHAPE_FILE} is missing: run scripts/render-perf/emitSchemaShape.ts first`)
      }
      return `export default ${readFileSync(file, 'utf8')}`
    },
  }
}
