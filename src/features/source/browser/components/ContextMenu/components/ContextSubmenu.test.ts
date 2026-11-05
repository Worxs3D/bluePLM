import { describe, expect, it } from 'vitest'

import { placeSubmenu, SUBMENU_GAP, SUBMENU_VIEWPORT_PADDING } from './ContextSubmenu'

const viewport = { width: 1000, height: 800 }
const size = { width: 200, height: 300 }

describe('placeSubmenu', () => {
  it('opens to the right of the row, its first row level with the row', () => {
    expect(placeSubmenu({ left: 100, right: 300, top: 50 }, size, viewport)).toEqual({
      left: 300 + SUBMENU_GAP,
      top: 46,
      side: 'right',
    })
  })

  it('flips to the left at the right edge of the window', () => {
    const placed = placeSubmenu({ left: 700, right: 900, top: 50 }, size, viewport)
    expect(placed).toEqual({ left: 700 - SUBMENU_GAP - 200, top: 46, side: 'left' })
  })

  it('stays inside the window when neither side has room', () => {
    const placed = placeSubmenu({ left: 50, right: 900, top: 50 }, size, viewport)
    expect(placed.left).toBe(viewport.width - SUBMENU_VIEWPORT_PADDING - 200)
  })

  it('moves up when it would run off the bottom, never above the top', () => {
    expect(placeSubmenu({ left: 0, right: 100, top: 700 }, size, viewport).top).toBe(
      viewport.height - SUBMENU_VIEWPORT_PADDING - 300,
    )
    expect(placeSubmenu({ left: 0, right: 100, top: 700 }, { width: 200, height: 900 }, viewport).top).toBe(
      SUBMENU_VIEWPORT_PADDING,
    )
  })
})
