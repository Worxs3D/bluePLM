/**
 * Geometry and document plumbing for Settings in a window of its own (`SettingsWindow`).
 */

/** `window.open` target name of the settings window; `electron/settingsWindow.ts` matches it. */
export const SETTINGS_WINDOW_FRAME = 'blueplm-settings'

/** Marks the settings window's root (and scopes its quirks-mode fixes in `index.css`). */
export const SETTINGS_WINDOW_ATTR = 'data-settings-window'

/**
 * Height of the settings window's own title bar, which the system's window controls overlay.
 * Must equal `TITLE_BAR_HEIGHT` in `electron/settingsWindow.ts`.
 */
export const SETTINGS_TITLE_BAR_HEIGHT = 40

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const MIN_WIDTH = 640
export const MIN_HEIGHT = 420
const MARGIN = 16

/** The modal's size, centred in the given area: where the window first opens. */
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
