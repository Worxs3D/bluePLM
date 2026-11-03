// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { promptHostFor, registerChildHost } from './useHostWindow'

function fakeWindow(focused: boolean): Window & { closed: boolean } {
  return { closed: false, document: { hasFocus: () => focused } } as unknown as Window & {
    closed: boolean
  }
}

describe('promptHostFor', () => {
  it('shows a prompt in the main window when no child window has focus', () => {
    const unregister = registerChildHost(fakeWindow(false))
    expect(promptHostFor({})).toBe(window)
    unregister()
  })

  it('shows a prompt in the focused child window, and keeps it there', () => {
    const child = fakeWindow(true)
    const unregister = registerChildHost(child)
    const prompt = {}
    expect(promptHostFor(prompt)).toBe(child)
    // Asked again (the other copy of the container): the same answer.
    expect(promptHostFor(prompt)).toBe(child)
    unregister()
  })

  it('moves a prompt back to the main window when its child window goes', () => {
    const child = fakeWindow(true)
    const unregister = registerChildHost(child)
    const prompt = {}
    expect(promptHostFor(prompt)).toBe(child)
    unregister()
    expect(promptHostFor(prompt)).toBe(window)

    const closing = fakeWindow(true)
    const unregisterClosing = registerChildHost(closing)
    const other = {}
    expect(promptHostFor(other)).toBe(closing)
    closing.closed = true
    expect(promptHostFor(other)).toBe(window)
    unregisterClosing()
  })
})
