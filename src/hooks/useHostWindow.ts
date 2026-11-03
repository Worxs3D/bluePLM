import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

/**
 * The browser window a component is rendered in. Settings on the desktop is rendered by the main
 * window into a window of its own (`SettingsWindow`), so a component there that listens for
 * clicks or keys, or measures the viewport, must use this window, not the global `window` and
 * `document`, which are the main window's.
 */
const HostWindowContext = createContext<Window | null>(null)

export function HostWindowProvider({ value, children }: { value: Window; children: ReactNode }) {
  return createElement(HostWindowContext.Provider, { value }, children)
}

/** The window this component is rendered in (the global `window` outside a `HostWindowProvider`). */
export function useHostWindow(): Window {
  return useContext(HostWindowContext) ?? window
}

/** The window an element is in, for code that holds an element rather than a hook. */
export function windowOf(el: Element | null | undefined): Window {
  return el?.ownerDocument.defaultView ?? window
}

// Windows the main window renders into (the settings window), so an app-wide prompt can open in
// the window the user is working in.
const childHosts = new Set<Window>()
const listeners = new Set<() => void>()
let childHostsVersion = 0

function notifyChildHosts(): void {
  childHostsVersion++
  for (const listener of listeners) listener()
}

/** Registers a window rendered from this one; the returned function unregisters it. */
export function registerChildHost(win: Window): () => void {
  childHosts.add(win)
  notifyChildHosts()
  return () => {
    if (childHosts.delete(win)) notifyChildHosts()
  }
}

function subscribeChildHosts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Re-renders the caller when a child window comes or goes. */
export function useChildHostsVersion(): number {
  return useSyncExternalStore(subscribeChildHosts, () => childHostsVersion)
}

const promptHosts = new WeakMap<object, Window>()

/**
 * The window a prompt shows in: the child window that had focus when the prompt was first seen,
 * for as long as that window stays open, else this (the main) window. Every copy of a prompt's
 * container asks with the same object and gets the same answer, so exactly one shows it.
 */
export function promptHostFor(prompt: object): Window {
  let host = promptHosts.get(prompt)
  if (!host) {
    host = [...childHosts].find((w) => !w.closed && w.document.hasFocus()) ?? window
    promptHosts.set(prompt, host)
  }
  return host !== window && (!childHosts.has(host) || host.closed) ? window : host
}
