import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import JSZip from 'jszip'

import {
  UnsafePackageError,
  extractPackageSafely,
  isSymlinkEntry,
  resolveEntryPath,
  validatePackageEntries,
} from './safeExtract'

/** Build a zip, write it out and read it back, the way an install sees a package. */
async function roundTrip(build: (zip: JSZip) => void, platform: 'UNIX' | 'DOS' = 'DOS') {
  const zip = new JSZip()
  build(zip)
  const bytes = await zip.generateAsync({ type: 'uint8array', platform })
  return JSZip.loadAsync(bytes)
}

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bpx-extract-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('resolveEntryPath', () => {
  const root = path.resolve('/pkg-root')

  it('resolves ordinary relative names inside the root', () => {
    expect(resolveEntryPath(root, 'extension.json')).toBe(path.join(root, 'extension.json'))
    expect(resolveEntryPath(root, 'client/index.js')).toBe(path.join(root, 'client', 'index.js'))
    expect(resolveEntryPath(root, 'a/./b.txt')).toBe(path.join(root, 'a', 'b.txt'))
  })

  it.each([
    '../evil.txt',
    'client/../../evil.txt',
    '..\\evil.txt',
    'client\\..\\..\\evil.txt',
    '/etc/passwd',
    '\\Windows\\evil.dll',
    'C:/evil.txt',
    'C:\\evil.txt',
    'c:evil.txt',
    'file.txt:stream',
    'bad\0name',
    '',
    '/',
    './',
  ])('refuses %j', (name) => {
    expect(() => resolveEntryPath(root, name)).toThrow(UnsafePackageError)
  })
})

describe('validatePackageEntries', () => {
  it('refuses an entry JSZip had to sanitize (zip-slip)', async () => {
    const zip = await roundTrip((z) => {
      z.file('extension.json', '{}')
      z.file('../../evil.txt', 'pwned')
    })
    expect(() => validatePackageEntries(zip)).toThrow(UnsafePackageError)
  })

  it('refuses an absolute entry', async () => {
    const zip = await roundTrip((z) => {
      z.file('/abs/evil.txt', 'pwned')
    })
    expect(() => validatePackageEntries(zip)).toThrow(UnsafePackageError)
  })

  it('refuses a symlink entry', async () => {
    const zip = await roundTrip((z) => {
      z.file('extension.json', '{}')
      z.file('link', '/etc/passwd', { unixPermissions: 0o120777 })
    }, 'UNIX')
    const link = zip.file('link')
    expect(link && isSymlinkEntry(link)).toBe(true)
    expect(() => validatePackageEntries(zip)).toThrow(/symbolic link/)
  })

  it('accepts a regular Unix file', async () => {
    const zip = await roundTrip((z) => {
      z.file('client/index.js', 'export {}', { unixPermissions: 0o100644 })
    }, 'UNIX')
    expect(validatePackageEntries(zip).map((e) => e.name)).toContain('client/index.js')
  })

  it('refuses a package with too many entries', async () => {
    const zip = await roundTrip((z) => {
      for (let i = 0; i < 5; i++) z.file(`f${i}.txt`, 'x')
    })
    expect(() => validatePackageEntries(zip, { maxEntries: 3 })).toThrow(/limit is 3/)
  })
})

describe('extractPackageSafely', () => {
  it('extracts into the destination and runs beforeCommit on the staging folder', async () => {
    const zip = await roundTrip((z) => {
      z.file('extension.json', '{"id":"a.b"}')
      z.file('client/index.js', 'export {}')
    })
    const dest = path.join(tmp, 'a-b')
    let stagingSeen = ''
    const result = await extractPackageSafely(zip, dest, {
      beforeCommit: (staging) => {
        stagingSeen = staging
        fs.writeFileSync(path.join(staging, '.metadata.json'), '{}')
      },
    })

    expect(result.files).toBe(2)
    expect(fs.readFileSync(path.join(dest, 'client', 'index.js'), 'utf-8')).toBe('export {}')
    expect(fs.existsSync(path.join(dest, '.metadata.json'))).toBe(true)
    expect(path.dirname(stagingSeen)).toBe(tmp)
    expect(fs.existsSync(stagingSeen)).toBe(false)
    // Only the destination is left in the parent: no staging or backup folders.
    expect(fs.readdirSync(tmp)).toEqual(['a-b'])
  })

  it('replaces the previous version only on success', async () => {
    const dest = path.join(tmp, 'a-b')
    fs.mkdirSync(dest)
    fs.writeFileSync(path.join(dest, 'old.txt'), 'old')

    const zip = await roundTrip((z) => z.file('new.txt', 'new'))
    await extractPackageSafely(zip, dest)

    expect(fs.existsSync(path.join(dest, 'old.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(dest, 'new.txt'), 'utf-8')).toBe('new')
    expect(fs.readdirSync(tmp)).toEqual(['a-b'])
  })

  it('leaves the previous version intact when the package is unsafe', async () => {
    const dest = path.join(tmp, 'a-b')
    fs.mkdirSync(dest)
    fs.writeFileSync(path.join(dest, 'old.txt'), 'old')

    const zip = await roundTrip((z) => {
      z.file('new.txt', 'new')
      z.file('../escape.txt', 'pwned')
    })
    await expect(extractPackageSafely(zip, dest)).rejects.toThrow(UnsafePackageError)

    expect(fs.readFileSync(path.join(dest, 'old.txt'), 'utf-8')).toBe('old')
    expect(fs.existsSync(path.join(tmp, 'escape.txt'))).toBe(false)
    expect(fs.readdirSync(tmp)).toEqual(['a-b'])
  })

  it('leaves the previous version intact when extraction fails part way', async () => {
    const dest = path.join(tmp, 'a-b')
    fs.mkdirSync(dest)
    fs.writeFileSync(path.join(dest, 'old.txt'), 'old')

    const zip = await roundTrip((z) => {
      z.file('a.txt', 'x'.repeat(600))
      z.file('b.txt', 'x'.repeat(600))
    })
    await expect(extractPackageSafely(zip, dest, { maxTotalBytes: 1000 })).rejects.toThrow(
      /larger than/,
    )
    expect(fs.readFileSync(path.join(dest, 'old.txt'), 'utf-8')).toBe('old')
    expect(fs.readdirSync(tmp)).toEqual(['a-b'])
  })

  it('leaves the previous version intact when beforeCommit throws', async () => {
    const dest = path.join(tmp, 'a-b')
    fs.mkdirSync(dest)
    fs.writeFileSync(path.join(dest, 'old.txt'), 'old')

    const zip = await roundTrip((z) => z.file('new.txt', 'new'))
    await expect(
      extractPackageSafely(zip, dest, {
        beforeCommit: () => {
          throw new Error('metadata failed')
        },
      }),
    ).rejects.toThrow('metadata failed')
    expect(fs.readdirSync(dest)).toEqual(['old.txt'])
    expect(fs.readdirSync(tmp)).toEqual(['a-b'])
  })
})
