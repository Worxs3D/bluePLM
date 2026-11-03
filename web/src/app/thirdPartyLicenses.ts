// Licence texts of third-party code that ships as a separate runtime module, emitted into every
// build (desktop `dist/`, web `dist-web/`) by the plugin below, which both Vite configs use.
//
// occt-import-js (OpenCascade compiled to WebAssembly, the STEP/IGES tessellator of the output
// preview) is LGPL-2.1: it is loaded unmodified as its own script and .wasm file, and its licence
// and the OCCT licence travel with it under `licenses/occt-import-js/`, with a NOTICE naming the
// sources.
import { readFileSync } from 'fs'
import { resolve } from 'path'

export const OCCT_LICENSE_DIR = 'licenses/occt-import-js'
export const OCCT_IMPORT_JS_VERSION = '0.0.23'

export const OCCT_NOTICE = `occt-import-js ${OCCT_IMPORT_JS_VERSION}
================================

BluePLM loads occt-import-js, unmodified, as a separate JavaScript module and WebAssembly file
(the 3D preview of STEP and IGES outputs). It is licensed under the GNU Lesser General Public
License, version 2.1: see license.occt-import-js.txt. It contains Open CASCADE Technology (OCCT),
licensed under the GNU LGPL 2.1 with the Open CASCADE exception: see license.occt.txt.

Source code:
- occt-import-js ${OCCT_IMPORT_JS_VERSION}: https://github.com/kovacsv/occt-import-js (tag v${OCCT_IMPORT_JS_VERSION}),
  npm package occt-import-js@${OCCT_IMPORT_JS_VERSION}
- Open CASCADE Technology: https://github.com/Open-Cascade-SAS/OCCT (the version occt-import-js
  ${OCCT_IMPORT_JS_VERSION} pins as its submodule)

You may replace the module with a modified build of the library: it is the occt-import-js-*.js
and occt-import-js-*.wasm pair in the assets folder.
`

export interface LicenseFile {
  fileName: string
  source: string
}

/** The files to emit, read from node_modules. Throws when a licence text is missing. */
export function thirdPartyLicenseFiles(root: string): LicenseFile[] {
  const dist = resolve(root, 'node_modules/occt-import-js/dist')
  return [
    ...['license.occt-import-js.txt', 'license.occt.txt'].map((name) => ({
      fileName: `${OCCT_LICENSE_DIR}/${name}`,
      source: readFileSync(resolve(dist, name), 'utf8'),
    })),
    { fileName: `${OCCT_LICENSE_DIR}/NOTICE.txt`, source: OCCT_NOTICE },
  ]
}

interface EmitContext {
  emitFile(file: { type: 'asset'; fileName: string; source: string }): string
}

/** Vite plugin: emit the licence files into the build output. */
export function thirdPartyLicenses(root: string) {
  return {
    name: 'blueplm-third-party-licenses',
    apply: 'build' as const,
    generateBundle(this: EmitContext) {
      for (const file of thirdPartyLicenseFiles(root)) this.emitFile({ type: 'asset', ...file })
    },
  }
}
