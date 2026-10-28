/**
 * `window.__BLUEPLM__`: the singletons a native extension shares with the app.
 *
 * An extension bundles everything except these; its build maps the imports to
 * `window.__BLUEPLM__.modules[name]`, which hold the app's module namespace
 * objects. One React instance is what lets the extension's components use hooks
 * and context inside the app's tree.
 */

import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import * as LucideReact from 'lucide-react'
import type { BluePLMGlobal } from '@/types/nativeExtensions'

declare global {
  interface Window {
    __BLUEPLM__?: BluePLMGlobal
  }
}

export function installBluePLMGlobal(appVersion: string): BluePLMGlobal {
  const existing = window.__BLUEPLM__
  if (existing && existing.appVersion === appVersion) return existing
  const global: BluePLMGlobal = Object.freeze({
    apiVersion: 1,
    appVersion,
    modules: Object.freeze({
      react: React,
      'react/jsx-runtime': ReactJsxRuntime,
      'react-dom': ReactDOM,
      'lucide-react': LucideReact,
    }),
  })
  window.__BLUEPLM__ = global
  return global
}
