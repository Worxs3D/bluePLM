// src/features/source/context-menu/hooks/useMenuPosition.ts
import { useState, useLayoutEffect, type RefObject } from 'react'
import { MENU_PADDING } from '../constants'

interface Position {
  x: number
  y: number
}

interface UseMenuPositionResult {
  position: Position
}

/** Where a menu of `size` opened at (`x`, `y`) goes so it stays inside `viewport`. */
export function clampMenuPosition(
  x: number,
  y: number,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): Position {
  let newX = x
  let newY = y
  // Check right overflow
  if (x + size.width > viewport.width - MENU_PADDING) {
    newX = viewport.width - size.width - MENU_PADDING
  }
  // Check bottom overflow
  if (y + size.height > viewport.height - MENU_PADDING) {
    newY = viewport.height - size.height - MENU_PADDING
  }
  // Ensure minimum position
  return { x: Math.max(MENU_PADDING, newX), y: Math.max(MENU_PADDING, newY) }
}

/**
 * Keeps the menu within the window: measured when it opens, and again whenever its size changes
 * (the "More actions" section expanded or collapsed) or the window resizes. Each time it starts
 * from the point that was clicked, so a menu that shrinks moves back towards it. Flyouts place
 * themselves (`ContextSubmenu`).
 */
export function useMenuPosition(
  initialX: number,
  initialY: number,
  menuRef: RefObject<HTMLDivElement | null>,
): UseMenuPositionResult {
  const [position, setPosition] = useState<Position>({ x: initialX, y: initialY })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return

    const place = () => {
      const rect = menu.getBoundingClientRect()
      const next = clampMenuPosition(
        initialX,
        initialY,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      )
      setPosition((current) =>
        current.x === next.x && current.y === next.y ? current : next,
      )
    }

    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(menu)
    window.addEventListener('resize', place)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [initialX, initialY, menuRef])

  return { position }
}
