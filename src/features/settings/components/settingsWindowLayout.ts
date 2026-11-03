/**
 * Geometry and document plumbing for Settings as a window: the desktop's own OS window
 * (`SettingsWindow`) and the floating panel used where there is none (`SettingsFloating`).
 */

/** `window.open` target name of the settings window; `electron/settingsWindow.ts` matches it. */
export const SETTINGS_WINDOW_FRAME = 'blueplm-settings'

/** Marks the settings window's root (and scopes its quirks-mode fixes in `index.css`). */
export const SETTINGS_WINDOW_ATTR = 'data-settings-window'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Edges {
  left?: boolean
  right?: boolean
  top?: boolean
  bottom?: boolean
}

export const MIN_WIDTH = 640
export const MIN_HEIGHT = 420
const MARGIN = 16
/** Height of the floating panel's header: it must stay on screen so the panel can be dragged back. */
const HEADER = 46

/** The size the modal used to have, centred in the viewport. */
export function defaultRect(viewWidth: number, viewHeight: number): Rect {
  const width = Math.max(Math.min(1200, viewWidth - 2 * MARGIN), Math.min(MIN_WIDTH, viewWidth))
  const height = Math.max(Math.min(880, viewHeight - 2 * MARGIN), Math.min(MIN_HEIGHT, viewHeight))
  return {
    x: Math.round((viewWidth - width) / 2),
    y: Math.round((viewHeight - height) / 2),
    width,
    height,
  }
}

/**
 * Keeps the panel reachable: no larger than the viewport, the header fully below the top edge
 * and at least a strip of it inside the other edges.
 */
export function clampRect(rect: Rect, viewWidth: number, viewHeight: number): Rect {
  const width = Math.min(Math.max(rect.width, Math.min(MIN_WIDTH, viewWidth)), viewWidth)
  const height = Math.min(Math.max(rect.height, Math.min(MIN_HEIGHT, viewHeight)), viewHeight)
  const keep = Math.min(120, width)
  const x = Math.min(Math.max(rect.x, keep - width), viewWidth - keep)
  const y = Math.min(Math.max(rect.y, 0), viewHeight - HEADER)
  return { x, y, width, height }
}

export function moveRect(
  rect: Rect,
  dx: number,
  dy: number,
  viewWidth: number,
  viewHeight: number,
): Rect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, viewWidth, viewHeight)
}

/** Drags the given edges by (dx, dy); an edge stops where the panel would get smaller than the minimum. */
export function resizeRect(
  rect: Rect,
  edges: Edges,
  dx: number,
  dy: number,
  viewWidth: number,
  viewHeight: number,
): Rect {
  let { x, y, width, height } = rect
  if (edges.right) width = Math.max(MIN_WIDTH, width + dx)
  if (edges.bottom) height = Math.max(MIN_HEIGHT, height + dy)
  if (edges.left) {
    const next = Math.max(MIN_WIDTH, width - dx)
    x += width - next
    width = next
  }
  if (edges.top) {
    const next = Math.max(MIN_HEIGHT, height - dy)
    y += height - next
    height = next
  }
  return clampRect({ x, y, width, height }, viewWidth, viewHeight)
}

/** Window features for `window.open`; the main process replaces the bounds with the saved ones. */
export function settingsWindowFeatures(screenWidth: number, screenHeight: number): string {
  const { width, height } = defaultRect(screenWidth, screenHeight)
  return `width=${width},height=${height}`
}

const HEAD_STYLE_SELECTOR = 'link[rel~="stylesheet"], style'

function isHeadStyle(node: Node): node is HTMLLinkElement | HTMLStyleElement {
  return node instanceof Element && node.matches(HEAD_STYLE_SELECTOR)
}

function copyAttributes(from: Element, to: Element): void {
  for (const attr of Array.from(to.attributes)) {
    if (!from.hasAttribute(attr.name)) to.removeAttribute(attr.name)
  }
  for (const attr of Array.from(from.attributes)) {
    if (to.getAttribute(attr.name) !== attr.value) to.setAttribute(attr.name, attr.value)
  }
}

/**
 * Gives `target` (the settings window's empty document) the app's styles and keeps them in step:
 * every stylesheet link and style element of `source`'s head (code-split chunks add theirs when
 * they load, the dev server rewrites its own on a hot update) and the attributes of `<html>`
 * (theme class, `data-theme`, `lang`). Returns the function that stops following and removes
 * the copied styles.
 */
export function mirrorDocumentStyles(source: Document, target: Document): () => void {
  const copies = new Map<Node, Node>()

  const copy = (node: HTMLLinkElement | HTMLStyleElement) => {
    if (copies.has(node)) return
    // The clone belongs to the other window, so `instanceof` against this window's classes fails.
    const clone = target.importNode(node, true) as HTMLLinkElement | HTMLStyleElement
    // A relative href would resolve against the window's own address, not the app's.
    if (node.tagName === 'LINK' && clone.tagName === 'LINK') {
      ;(clone as HTMLLinkElement).href = (node as HTMLLinkElement).href
    }
    target.head.appendChild(clone)
    copies.set(node, clone)
  }

  for (const node of Array.from(source.head.querySelectorAll(HEAD_STYLE_SELECTOR))) {
    if (isHeadStyle(node)) copy(node)
  }
  copyAttributes(source.documentElement, target.documentElement)

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.target === source.documentElement && record.type === 'attributes') {
        copyAttributes(source.documentElement, target.documentElement)
        continue
      }
      if (record.target === source.head) {
        for (const node of Array.from(record.addedNodes)) if (isHeadStyle(node)) copy(node)
        for (const node of Array.from(record.removedNodes)) {
          const clone = copies.get(node)
          if (clone) {
            clone.parentNode?.removeChild(clone)
            copies.delete(node)
          }
        }
        continue
      }
      // The text of a style element changed (a hot update).
      const style = record.target instanceof Element ? record.target : record.target.parentElement
      const clone = style ? copies.get(style) : undefined
      if (style && clone) clone.textContent = style.textContent
    }
  })
  observer.observe(source.head, { childList: true, subtree: true, characterData: true })
  observer.observe(source.documentElement, { attributes: true })

  // Stopping removes the copies too, so the same window can be set up again.
  return () => {
    observer.disconnect()
    for (const clone of copies.values()) clone.parentNode?.removeChild(clone)
    copies.clear()
  }
}
