/**
 * The fake SolidWorks service speaks the real wire: every action it answers and every error code
 * it emits is in `solidworks-service/wire-manifest.json` (workstream A's contract, checked against
 * Program.cs from the C# side), and it returns every response field the app is pinned to read.
 * Without this the stub could keep answering an action the service renamed.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ANSWERED_BY_MAIN,
  FAKE_SERVICE_ERROR_CODES,
  FAKE_SOLIDWORKS_METHODS,
  createFakeElectron,
} from './fakeElectron'

interface WireManifest {
  actions: Record<string, { request: string[]; responseData?: string[] }>
  errorCodes: { service: string[] }
}

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../solidworks-service/wire-manifest.json'), 'utf8'),
) as WireManifest

describe('the fake SolidWorks service matches the wire manifest', () => {
  it('answers only actions the service has', () => {
    const forwarded = FAKE_SOLIDWORKS_METHODS.filter((m) => !ANSWERED_BY_MAIN.has(m))
    expect(forwarded.filter((m) => !(m in manifest.actions))).toEqual([])
  })

  it('emits only error codes the service emits', () => {
    expect(Object.values(FAKE_SERVICE_ERROR_CODES).filter((c) => !manifest.errorCodes.service.includes(c))).toEqual([])
  })

  it('returns every response field the app reads', async () => {
    const electron = createFakeElectron()
    const path = 'C:\\vault\\part.sldprt'
    electron.disk.write(path, 'bytes', {
      fileProperties: { Number: 'BR-1' },
      configurations: [{ name: 'Default', properties: { Number: 'BR-1' } }],
    })
    const sw = electron.api.solidworks
    const replies: Record<string, unknown> = {
      getProperties: await sw.getProperties(path),
      setPropertiesBatch: await sw.setPropertiesBatch(path, { Default: { Number: 'BR-2' } }),
    }
    for (const [action, reply] of Object.entries(replies)) {
      const data = (reply as { data?: Record<string, unknown> }).data ?? {}
      const expected = manifest.actions[action].responseData ?? []
      expect(expected.filter((field) => !(field in data)), action).toEqual([])
    }
  })
})
