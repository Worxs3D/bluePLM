import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { newWorkbook, writeWorkbook } from '@/lib/inspection/excel/workbook'

import { zipUncompressedSize } from './zipGuard'

async function zip(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const z = new JSZip()
  for (const [name, data] of Object.entries(files)) z.file(name, data)
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

describe('zipUncompressedSize', () => {
  it('sums the expanded size of a real workbook', async () => {
    const wb = await newWorkbook()
    wb.addWorksheet('Sheet').getCell('A1').value = 'x'
    const result = zipUncompressedSize(await writeWorkbook(wb))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.entries).toBeGreaterThan(3)
  })

  it('refuses an archive that inflates past the cap before inflating it', async () => {
    // 4 MB of zeros compresses to a few KB.
    const bomb = await zip({ 'a.xml': new Uint8Array(4 * 1024 * 1024), 'b.xml': new Uint8Array(4 * 1024 * 1024) })
    expect(bomb.byteLength).toBeLessThan(100_000)
    const result = zipUncompressedSize(bomb, 6 * 1024 * 1024)
    expect(result).toMatchObject({ ok: false, reason: 'tooLarge' })
    expect(zipUncompressedSize(bomb, 10 * 1024 * 1024)).toMatchObject({ ok: true, uncompressed: 8 * 1024 * 1024 })
  })

  it('refuses too many entries and bytes that are not a ZIP', async () => {
    const many = await zip(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}`, 'x'])))
    expect(zipUncompressedSize(many, 1e9, 10)).toMatchObject({ ok: false, reason: 'tooManyEntries' })
    expect(zipUncompressedSize(new TextEncoder().encode('not a zip at all, just text'))).toMatchObject({
      ok: false,
      reason: 'notZip',
    })
  })
})
