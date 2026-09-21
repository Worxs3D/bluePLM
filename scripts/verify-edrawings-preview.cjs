/*
 * Manual Windows integration check for the optional eDrawings embedding path.
 * Requires eDrawings and a local CAD sample below C:\BluePLM.
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const resultPath = path.join(os.tmpdir(), 'BluePLM-eDrawings-preview-test-result.json')
const checkpointPath = path.join(os.tmpdir(), 'BluePLM-eDrawings-preview-test-checkpoint.json')
fs.rmSync(resultPath, { force: true })
fs.rmSync(checkpointPath, { force: true })

function checkpoint(stage) {
  fs.writeFileSync(checkpointPath, JSON.stringify({ stage, at: new Date().toISOString() }))
}

function findCadFile(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = findCadFile(entryPath)
      if (nested) return nested
    } else if (/\.(sldprt|sldasm|step|stp)$/i.test(entry.name)) {
      return entryPath
    }
  }
  return null
}

app.whenReady().then(async () => {
  checkpoint('app-ready')
  const sample = findCadFile('C:\\BluePLM')
  if (!sample) throw new Error('No local CAD sample found below C:\\BluePLM.')

  const window = new BrowserWindow({
    show: process.env.BLUEPLM_SHOW_PREVIEW_TEST === '1',
    width: 960,
    height: 640,
  })
  await window.loadURL('data:text/html,<body style="margin:0;background:#000;color:#fff"><main>BluePLM eDrawings integration check</main></body>')
  checkpoint('window-loaded')

  const addon = require(path.join(__dirname, '..', 'resources', 'bin', 'win32', 'edrawings_preview.node'))
  const host = path.join(
    __dirname,
    '..',
    'edrawings-preview-host',
    'publish',
    'win-x64',
    'BluePLM.EDrawingsPreviewHost.exe',
  )
  const preview = new addon.EDrawingsPreview()
  checkpoint('before-attach')
  if (!preview.attachToWindow(window.getNativeWindowHandle())) {
    throw new Error(preview.lastError())
  }
  checkpoint('after-attach')
  // Production first reports the final panel geometry and then starts the
  // host. Keeping the same order prevents a 1×1 ActiveX render surface.
  checkpoint('before-initial-bounds')
  if (!preview.setBounds(0, 0, 960, 640)) {
    throw new Error(preview.lastError() || 'Could not size the embedded preview.')
  }
  checkpoint('after-initial-bounds')
  checkpoint('before-load-file')
  if (!preview.loadFile(sample, host) || !preview.show()) {
    throw new Error(preview.lastError() || 'Could not size or show the embedded preview.')
  }
  checkpoint('after-load-and-show')

  const durationMs = Number.parseInt(process.env.BLUEPLM_PREVIEW_TEST_DURATION_MS ?? '12000', 10)
  setTimeout(() => {
    checkpoint('before-visual-sample')
    const visual = preview.getVisualState()
    // A valid eDrawings viewport includes its grey scene background and model.
    // A near-completely black capture is the exact regression the user sees.
    const rendered = visual.available && (visual.brightRatio > 0.1 || visual.luminanceVariance > 30)
    const result = { loaded: preview.isLoaded(), rendered, visual, error: preview.lastError() }
    fs.writeFileSync(resultPath, JSON.stringify(result))
    checkpoint('result-written')
    preview.destroy()
    window.destroy()
    console.log(JSON.stringify(result))
    app.exitCode = rendered ? 0 : 1
    app.quit()
  }, Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 6000)
}).catch((error) => {
  console.error(error.stack || String(error))
  app.exitCode = 1
  app.quit()
})
