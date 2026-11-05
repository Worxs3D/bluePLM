// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import {
  defaultRect,
  mirrorDocumentStyles,
  SETTINGS_TITLE_BAR_HEIGHT,
  SETTINGS_WINDOW_FRAME,
} from './settingsWindowLayout'

describe('settings window geometry', () => {
  it('opens at the modal size, centred', () => {
    expect(defaultRect(1920, 1080)).toEqual({ x: 360, y: 100, width: 1200, height: 880 })
    expect(defaultRect(1000, 700)).toEqual({ x: 16, y: 16, width: 968, height: 668 })
  })
})

describe('settings window', () => {
  // electron/settingsWindow.test.ts checks the main process matches the same name.
  it('opens under the frame name the main process lets through', () => {
    expect(SETTINGS_WINDOW_FRAME).toBe('blueplm-settings')
  })

  // electron/settingsWindow.test.ts checks the main process draws its controls at this height.
  it('has a title bar as tall as the window controls overlay', () => {
    expect(SETTINGS_TITLE_BAR_HEIGHT).toBe(40)
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
