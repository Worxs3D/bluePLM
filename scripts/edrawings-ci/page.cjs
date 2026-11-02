/* global document, require, window */
/* eslint-disable @typescript-eslint/no-require-imports -- Renderer script of an Electron CI harness, run with nodeIntegration. */
/*
 * Renderer half of scripts/edrawings-ci/system-check.cjs. It runs the app's own overlay logic
 * (nativePreviewOverlay.ts): the observer counts a dialog as an overlay, and the visibility
 * controller asks the main process to hide the native preview, exactly as
 * EDrawingsEmbeddedPreview.tsx wires it. The dialog carries the same markers as
 * src/components/core/Dialog/Dialog.tsx (role="dialog", data-native-preview-overlay="modal").
 */
const { ipcRenderer } = require('electron')
// The main process transpiles nativePreviewOverlay.ts and hands over the module's path.
const {
  createNativePreviewVisibilityController,
  observeNativePreviewOverlays,
} = require(ipcRenderer.sendSync('ci:overlay-module'))

const host = document.getElementById('preview')
const visibility = createNativePreviewVisibilityController({
  hide: () => ipcRenderer.invoke('ci:hide'),
  show: () => ipcRenderer.invoke('ci:show'),
})
observeNativePreviewOverlays(host, count => visibility.setOverlayCount(count))

function rectOf(element) {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

window.ciPreviewBounds = () => {
  const scale = window.devicePixelRatio || 1
  const rect = rectOf(host)
  return {
    css: rect,
    scale,
    device: {
      x: rect.left * scale,
      y: rect.top * scale,
      width: rect.width * scale,
      height: rect.height * scale,
    },
  }
}

window.ciSetReady = ready => visibility.setReady(ready)

window.ciOpenDialog = () => {
  const dialog = document.createElement('div')
  dialog.id = 'dialog'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('data-native-preview-overlay', 'modal')
  const button = document.createElement('button')
  button.textContent = 'Confirm'
  button.addEventListener('click', () => ipcRenderer.send('ci:dialog-clicked'))
  dialog.appendChild(button)
  document.body.appendChild(dialog)
  return rectOf(button)
}

window.ciCloseDialog = () => {
  document.getElementById('dialog')?.remove()
}
