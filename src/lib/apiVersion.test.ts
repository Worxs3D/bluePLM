import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

// apiVersion.ts reads the API URL from the store; none of that is needed here.
vi.mock('../stores/pdmStore', () => ({ usePDMStore: { getState: () => ({}) } }))

import {
  API_VERSION_DESCRIPTIONS,
  EXPECTED_API_VERSION,
  MINIMUM_COMPATIBLE_API_VERSION,
} from './apiVersion'

// An API change is two edits in two places (CLAUDE.md): `version` in
// api/package.json and EXPECTED_API_VERSION here, plus a description. Missing
// one is silent until a deployed API reports a version the app calls "newer"
// or "outdated" when it is neither. This is the API twin of schemaVersion.test.ts.
const API_PACKAGE = resolve(__dirname, '../../api/package.json')

const apiPackageVersion = (JSON.parse(readFileSync(API_PACKAGE, 'utf8')) as { version: string })
  .version

describe('API version parity', () => {
  it('api/package.json version is the version the app expects', () => {
    expect(apiPackageVersion).toBe(EXPECTED_API_VERSION)
  })

  it('the expected version has a description', () => {
    expect(API_VERSION_DESCRIPTIONS[EXPECTED_API_VERSION]?.trim()).toBeTruthy()
  })

  it('the minimum compatible version is a described release', () => {
    expect(API_VERSION_DESCRIPTIONS[MINIMUM_COMPATIBLE_API_VERSION]?.trim()).toBeTruthy()
  })
})
