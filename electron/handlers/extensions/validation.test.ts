import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import {
  EXTENSION_ID_PATTERN,
  EXTENSION_VERSION_PATTERN,
  extensionFolderName,
  isValidExtensionId,
  isValidExtensionVersion,
  parseExtensionManifest,
} from './validation'
import { assertPackageIntegrity, matchesSha256, normalizeSha256, sha256Hex } from './integrity'

const here = path.dirname(fileURLToPath(import.meta.url))
const schemaPath = path.resolve(here, '../../../schemas/extension-v1.schema.json')

describe('extension id and version patterns', () => {
  it('match the patterns in schemas/extension-v1.schema.json', () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8')) as {
      properties: { id: { pattern: string }; version: { pattern: string } }
    }
    expect(EXTENSION_ID_PATTERN.source).toBe(schema.properties.id.pattern)
    expect(EXTENSION_VERSION_PATTERN.source).toBe(schema.properties.version.pattern)
  })

  it.each(['blueplm.google-drive', 'acme.customers', 'a.b', 'pub-1.ext-2'])('accepts id %j', (id) => {
    expect(isValidExtensionId(id)).toBe(true)
  })

  it.each([
    '',
    'nodot',
    '../etc.passwd',
    'a.b/../../c',
    'a.b\\c',
    'A.b',
    '1a.b',
    'a..b',
    'a.b.c',
    '.a.b',
    'a.b ',
    `a.${'b'.repeat(200)}`,
    42,
    null,
    undefined,
  ])('refuses id %j', (id) => {
    expect(isValidExtensionId(id)).toBe(false)
  })

  it.each(['1.0.0', '0.1.2-beta.1', '1.2.3+build.5'])('accepts version %j', (v) => {
    expect(isValidExtensionVersion(v)).toBe(true)
  })

  it.each(['1.0', 'v1.0.0', '1.0.0/../x', '', '1.0.0 '])('refuses version %j', (v) => {
    expect(isValidExtensionVersion(v)).toBe(false)
  })

  it('derives a folder name only from a valid id', () => {
    expect(extensionFolderName('blueplm.google-drive')).toBe('blueplm-google-drive')
    expect(() => extensionFolderName('../x.y')).toThrow(/Invalid extension id/)
  })
})

describe('parseExtensionManifest', () => {
  const valid = { id: 'acme.tool', name: 'Tool', version: '1.0.0', publisher: 'acme' }

  it('accepts a minimal valid manifest', () => {
    expect(parseExtensionManifest(JSON.stringify(valid)).id).toBe('acme.tool')
  })

  it.each([
    ['not json', '{', /not valid JSON/],
    ['array', '[]', /must be an object/],
    ['traversal id', JSON.stringify({ ...valid, id: '../../evil' }), /Invalid manifest: id/],
    ['missing id', JSON.stringify({ ...valid, id: undefined }), /Invalid manifest: id/],
    ['bad version', JSON.stringify({ ...valid, version: 'latest' }), /version/],
    ['no name', JSON.stringify({ ...valid, name: '' }), /name/],
    ['no publisher', JSON.stringify({ ...valid, publisher: undefined }), /publisher/],
    ['bad category', JSON.stringify({ ...valid, category: 'kernel' }), /category/],
  ])('refuses %s', (_label, content, message) => {
    expect(() => parseExtensionManifest(content)).toThrow(message)
  })
})

describe('package integrity', () => {
  const data = new TextEncoder().encode('package bytes')
  const hash = sha256Hex(data)

  it('normalizes stated hashes', () => {
    expect(normalizeSha256(hash.toUpperCase())).toBe(hash)
    expect(normalizeSha256(`sha256:${hash}`)).toBe(hash)
    expect(normalizeSha256('abc')).toBeNull()
    expect(normalizeSha256(null)).toBeNull()
  })

  it('matches only the right bytes', () => {
    expect(matchesSha256(data, hash)).toBe(true)
    expect(matchesSha256(new TextEncoder().encode('other'), hash)).toBe(false)
    expect(matchesSha256(data, 'not-a-hash')).toBe(false)
  })

  it('fails closed when the store states no hash', () => {
    expect(() => assertPackageIntegrity(data, null)).toThrow(/did not provide a valid SHA-256/)
    expect(() => assertPackageIntegrity(data, '')).toThrow(/did not provide a valid SHA-256/)
  })

  it('refuses a mismatch and returns the hash on a match', () => {
    expect(() => assertPackageIntegrity(data, '0'.repeat(64))).toThrow(/does not match/)
    expect(assertPackageIntegrity(data, hash)).toBe(hash)
  })
})
