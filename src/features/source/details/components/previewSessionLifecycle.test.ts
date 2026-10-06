import { describe, expect, it } from 'vitest'

import { createPreviewSessionLifecycle } from './previewSessionLifecycle'

describe('embedded eDrawings preview session lifecycle', () => {
  it('rejects a session created after its component unmounts while retaining its token for cleanup', () => {
    const lifecycle = createPreviewSessionLifecycle()

    lifecycle.dispose()
    lifecycle.registerSession('preview-a')

    expect(lifecycle.isActive('preview-a')).toBe(false)
    expect(lifecycle.sessionId).toBe('preview-a')
  })

  it('does not let a stale preview session become active after a newer panel starts', () => {
    const previewA = createPreviewSessionLifecycle()
    previewA.registerSession('preview-a')
    previewA.dispose()

    const previewB = createPreviewSessionLifecycle()
    previewB.registerSession('preview-b')

    expect(previewA.isActive('preview-a')).toBe(false)
    expect(previewB.isActive('preview-b')).toBe(true)
    expect(previewB.isActive('preview-a')).toBe(false)
  })
})
