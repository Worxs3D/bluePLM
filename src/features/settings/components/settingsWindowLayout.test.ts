// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import {
  clampRect,
  defaultRect,
  MIN_HEIGHT,
  MIN_WIDTH,
  mirrorDocumentStyles,
  moveRect,
  resizeRect,
  SETTINGS_WINDOW_FRAME,
} from './settingsWindowLayout'

describe('floating settings geometry', () => {
  it('opens at the old modal size, centred', () => {
    expect(defaultRect(1920, 1080)).toEqual({ x: 360, y: 100, width: 1200, height: 880 })
    expect(defaultRect(1000, 700)).toEqual({ x: 16, y: 16, width: 968, height: 668 })
  })

  it('never gets smaller than the minimum, or larger than the view', () => {
    const r = resizeRect(
      { x: 100, y: 100, width: 800, height: 600 },
      { right: true, bottom: true },
      -900,
      -900,
      1920,
      1080,
    )
    expect(r).toMatchObject({ width: MIN_WIDTH, height: MIN_HEIGHT })
    expect(clampRect({ x: 0, y: 0, width: 3000, height: 3000 }, 1280, 720)).toMatchObject({
      width: 1280,
      height: 720,
    })
  })

  it('resizing from the left or top keeps the opposite edge where it was', () => {
    const r = resizeRect(
      { x: 200, y: 200, width: 800, height: 600 },
      { left: true, top: true },
      50,
      30,
      1920,
      1080,
    )
    expect(r).toEqual({ x: 250, y: 230, width: 750, height: 570 })
    // Stopped by the minimum: the right edge still does not move.
    const stopped = resizeRect(
      { x: 200, y: 200, width: 800, height: 600 },
      { left: true },
      500,
      0,
      1920,
      1080,
    )
    expect(stopped.x + stopped.width).toBe(1000)
    expect(stopped.width).toBe(MIN_WIDTH)
  })

  it('keeps the header reachable when dragged off screen', () => {
    const r = moveRect({ x: 100, y: 100, width: 800, height: 600 }, -5000, -5000, 1920, 1080)
    expect(r.y).toBe(0)
    expect(r.x + r.width).toBeGreaterThanOrEqual(120)
    const down = moveRect({ x: 100, y: 100, width: 800, height: 600 }, 5000, 5000, 1920, 1080)
    expect(down.y).toBeLessThanOrEqual(1080 - 46)
    expect(down.x).toBeLessThanOrEqual(1920 - 120)
  })
})

describe('settings window', () => {
  // electron/settingsWindow.test.ts checks the main process matches the same name.
  it('opens under the frame name the main process lets through', () => {
    expect(SETTINGS_WINDOW_FRAME).toBe('blueplm-settings')
  })
})

describe('mirrorDocumentStyles', () => {
  const target = () => document.implementation.createHTMLDocument('settings')

  afterEach(() => {
    document.head.replaceChildren()
    document.documentElement.removeAttribute('data-theme')
  })

  it('copies stylesheets with absolute addresses, and the theme', () => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.setAttribute('href', './assets/index.css')
    document.head.appendChild(link)
    const style = document.createElement('style')
    style.textContent = '.a { color: red }'
    document.head.appendChild(style)
    document.documentElement.setAttribute('data-theme', 'dark')

    const doc = target()
    const stop = mirrorDocumentStyles(document, doc)
    const copied = doc.head.querySelector('link')
    expect(copied?.getAttribute('href')).toBe(link.href)
    expect(doc.head.querySelector('style')?.textContent).toBe('.a { color: red }')
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark')

    stop()
    expect(doc.head.querySelector('link, style')).toBeNull()
  })

  it('follows styles added, changed and removed later, and theme switches', async () => {
    const doc = target()
    const stop = mirrorDocumentStyles(document, doc)

    const style = document.createElement('style')
    style.textContent = '.b {}'
    document.head.appendChild(style)
    document.documentElement.setAttribute('data-theme', 'light')
    await Promise.resolve()
    expect(doc.head.querySelector('style')?.textContent).toBe('.b {}')
    expect(doc.documentElement.getAttribute('data-theme')).toBe('light')

    style.textContent = '.c {}'
    await Promise.resolve()
    expect(doc.head.querySelector('style')?.textContent).toBe('.c {}')

    style.remove()
    await Promise.resolve()
    expect(doc.head.querySelector('style')).toBeNull()
    stop()
  })
})
