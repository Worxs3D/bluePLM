import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import { OCCT_IMPORT_JS_VERSION, OCCT_LICENSE_DIR, thirdPartyLicenses } from './thirdPartyLicenses'

const ROOT = resolve(__dirname, '../../..')

describe('third-party licences in the build', () => {
  it('emits both LGPL texts and a NOTICE under licenses/occt-import-js', () => {
    const emitted: Array<{ fileName: string; source: string }> = []
    const plugin = thirdPartyLicenses(ROOT)
    plugin.generateBundle.call({
      emitFile: (file) => {
        emitted.push(file)
        return file.fileName
      },
    })
    expect(emitted.map((f) => f.fileName).sort()).toEqual([
      `${OCCT_LICENSE_DIR}/NOTICE.txt`,
      `${OCCT_LICENSE_DIR}/license.occt-import-js.txt`,
      `${OCCT_LICENSE_DIR}/license.occt.txt`,
    ])
    for (const file of emitted) expect(file.source.length).toBeGreaterThan(100)
    expect(emitted.find((f) => f.fileName.endsWith('NOTICE.txt'))!.source).toContain('github.com/kovacsv/occt-import-js')
  })

  it('names the installed version and is wired into both Vite configs', () => {
    const installed = JSON.parse(readFileSync(resolve(ROOT, 'node_modules/occt-import-js/package.json'), 'utf8')) as {
      version: string
    }
    expect(installed.version).toBe(OCCT_IMPORT_JS_VERSION)
    for (const config of ['vite.config.ts', 'vite.web.config.ts']) {
      expect(readFileSync(resolve(ROOT, config), 'utf8')).toContain('thirdPartyLicenses(__dirname)')
    }
  })
})
