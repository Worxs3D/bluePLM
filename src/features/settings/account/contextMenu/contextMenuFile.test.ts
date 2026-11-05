import { describe, expect, it } from 'vitest'

import { pinEntry } from '@/lib/contextMenu/edit'
import { DEFAULT_LAYOUT } from '@/lib/contextMenu/entries'

import { parseLayoutFile, serializeLayout } from './contextMenuFile'

describe('menu layout files', () => {
  it('reads back what it writes', () => {
    const layout = pinEntry(DEFAULT_LAYOUT, 'generate.local.step')
    const parsed = parseLayoutFile(serializeLayout(layout))
    expect(parsed).toEqual({ ok: true, layout })
  })

  it('accepts a bare layout and refuses anything else', () => {
    expect(parseLayoutFile(JSON.stringify(DEFAULT_LAYOUT)).ok).toBe(true)
    expect(parseLayoutFile('{not json')).toEqual({ ok: false, error: 'invalidJson' })
    expect(parseLayoutFile(JSON.stringify({ shortcuts: {} }))).toEqual({ ok: false, error: 'notLayout' })
  })
})

describe('importLayoutFile', () => {
  it('refuses a file over the size limit without reading it', async () => {
    const { importLayoutFile, MAX_LAYOUT_FILE_BYTES } = await import('./contextMenuFile')
    let read = false
    const file = {
      size: MAX_LAYOUT_FILE_BYTES + 1,
      text: async () => {
        read = true
        return serializeLayout(DEFAULT_LAYOUT)
      },
    } as unknown as File
    const toasts: string[] = []
    const result = await importLayoutFile(file, (key) => key, (_type, message) => toasts.push(message))
    expect(result).toBeNull()
    expect(read).toBe(false)
    expect(toasts).toEqual(['contextMenuCustomizer.file.importTooLarge'])
  })
})
