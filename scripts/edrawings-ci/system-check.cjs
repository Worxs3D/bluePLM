/* global __dirname, console, process, require, setTimeout */
/* eslint-disable @typescript-eslint/no-require-imports -- Electron CI harness that loads the TypeScript handler and the native addon at runtime. */
/*
 * The three eDrawings checks that used to need a person, run on a real Windows desktop in CI
 * (started by scripts/edrawings-ci/run.cjs, which builds what this needs):
 *
 *  (a) A dialog opened over the embedded preview is on top and takes a real mouse click.
 *      The preview is a separate process whose window Windows keeps above BluePLM's (an owned
 *      window), so the app must hide it while a dialog is open. This drives the app's own code
 *      for that: the native addon, createEDrawingsPreviewController, and in the page the
 *      overlay observer and visibility controller. The host is the real preview host built
 *      with EDRAWINGS_TEST_SURFACE, which shows a plain panel instead of the eDrawings control,
 *      because CI has no eDrawings. Windows itself is asked what is under the pointer, and the
 *      click is a real SendInput click.
 *  (b) Without the .NET 8 Desktop Runtime the embedded option is unavailable: the real runtime
 *      detection against a real install and against a Program Files that has only other
 *      runtimes. (The settings button's disabled state is SettingsTab.test.tsx.)
 *  (c) A vault on a UNC share: the embedded preview refuses it with preview-vault-not-local,
 *      starting no host, and "Open in eDrawings" finds the viewer through the real discovery
 *      and starts it on the UNC path, which the viewer can read. The share is a real SMB share
 *      on this machine; the viewer is a stub eDrawings.exe that records what it was given.
 *
 * Exit code 0 when every check passes. Results are also written to <work>/results.json.
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const work = process.env.BLUEPLM_CI_WORK
const addonPath = process.env.BLUEPLM_CI_ADDON
const hostPath = process.env.BLUEPLM_CI_HOST
const viewerDirectory = process.env.BLUEPLM_CI_VIEWER_DIR
if (!work || !addonPath || !hostPath || !viewerDirectory) {
  throw new Error('Run this through scripts/edrawings-ci/run.cjs.')
}

const results = []
function record(name, passed, detail) {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) return value
    await delay(100)
  }
}

function powershell(args) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) throw new Error(result.stderr || `powershell ${args.join(' ')} failed`)
  return result.stdout.trim()
}

function probe(action, x, y) {
  const output = powershell(['-File', path.join(__dirname, 'probe.ps1'), action, String(Math.round(x)), String(Math.round(y))])
  return Number.parseInt(output.split(/\r?\n/).pop(), 10)
}

/**
 * Start a freshly built executable once and time it. A runner scans a new executable on its first
 * start, which can outlast the host's 10 s startup handshake; that is a property of the runner, not
 * of BluePLM, whose installed host is scanned once at install.
 */
function warmUp(label, executable, args) {
  const started = Date.now()
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, timeout: 120_000 })
  console.log(`warm-up ${label}: exit ${result.status ?? result.signal ?? String(result.error)} after ${Date.now() - started} ms`)
}

/** Run the host directly, outside the addon, to show why a load through the controller failed. */
function diagnoseHost(file) {
  const statusFile = path.join(work, 'host-diagnostic-status')
  const started = Date.now()
  const result = spawnSync(hostPath, ['--file', file, '--status-file', statusFile, '--parent', '0', '--bounds', '0', '0', '10', '10'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  })
  return {
    exit: result.status ?? result.signal ?? String(result.error),
    ms: Date.now() - started,
    stderr: result.stderr?.slice(0, 2000),
    status: fs.existsSync(statusFile) ? fs.readFileSync(statusFile).toString('hex').slice(0, 200) : null,
  }
}

function previewHostProcessIds() {
  const output = powershell([
    '-Command',
    '(Get-Process -Name "BluePLM.EDrawingsPreviewHost" -ErrorAction SilentlyContinue).Id -join ","',
  ])
  return output.split(',').filter(Boolean).map(value => Number.parseInt(value, 10))
}

function writeSample(directory) {
  fs.mkdirSync(path.join(directory, 'Parts'), { recursive: true })
  const file = path.join(directory, 'Parts', 'bracket.sldprt')
  fs.writeFileSync(file, 'not a real part; the CI host never opens it')
  return file
}

/** (a) Dialogs over the embedded preview. */
async function checkDialogOverPreview(edrawings, addon) {
  const vault = path.join(work, 'local-vault')
  const file = writeSample(vault)
  const overlaySource = path.join(__dirname, '..', '..', 'src', 'features', 'source', 'details', 'components', 'nativePreviewOverlay.ts')
  const overlayModule = path.join(work, 'nativePreviewOverlay.cjs')
  fs.writeFileSync(
    overlayModule,
    require('esbuild').transformSync(fs.readFileSync(overlaySource, 'utf8'), { loader: 'ts', format: 'cjs' }).code,
  )
  ipcMain.on('ci:overlay-module', event => {
    event.returnValue = overlayModule
  })
  const window = new BrowserWindow({
    x: 60,
    y: 60,
    width: 900,
    height: 700,
    useContentSize: true,
    show: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
  })
  window.webContents.on('console-message', event => {
    console.log(`[page ${event.level}] ${event.message}`)
  })
  await window.loadFile(path.join(__dirname, 'page.html'))
  window.focus()

  let nativePreview = null
  const controller = edrawings.createEDrawingsPreviewController({
    createPreview: () => (nativePreview = new addon.EDrawingsPreview()),
    getPreviewHostPath: () => hostPath,
    validateFile: filePath => edrawings.validateEDrawingsPreviewFile(filePath, vault),
    logWarn: (message, data) => console.warn(message, data ?? ''),
  })
  const senderId = window.webContents.id
  const created = controller.create(window, senderId)
  if (!created.success) {
    record('a: preview session created', false, created)
    return { window, controller, senderId }
  }
  const { sessionId } = created
  ipcMain.handle('ci:hide', () => controller.hide(sessionId, senderId))
  ipcMain.handle('ci:show', () => controller.show(sessionId, senderId))
  let dialogClicks = 0
  ipcMain.on('ci:dialog-clicked', () => {
    dialogClicks += 1
  })

  const attached = await controller.attach(sessionId, senderId)
  const loaded = await controller.load(sessionId, senderId, file)
  record('a: test-surface host loads through the real controller', attached.success && loaded.success, { attached, loaded })
  if (!loaded.success) {
    console.log('host diagnostic', JSON.stringify(diagnoseHost(file)))
    return { window, controller, senderId, sessionId }
  }

  const bounds = await window.webContents.executeJavaScript('window.ciPreviewBounds()')
  await controller.setBounds(sessionId, senderId, bounds.device)
  await window.webContents.executeJavaScript('window.ciSetReady(true)')
  const shown = await waitFor(() => nativePreview.getWindowState().visible)
  const state = nativePreview.getWindowState()
  record('a: preview shown and owned by the BluePLM window', Boolean(shown) && state.ownedByHost, state)

  const hostIds = previewHostProcessIds()
  const centre = {
    x: state.viewerBounds.left + state.viewerBounds.width / 2,
    y: state.viewerBounds.top + state.viewerBounds.height / 2,
  }
  // Positive control: the probe sees the preview window covering the page, so it can tell.
  const ownerBeforeDialog = probe('point', centre.x, centre.y)
  record('a: Windows reports the preview on top before a dialog opens', hostIds.includes(ownerBeforeDialog), {
    ownerBeforeDialog,
    hostIds,
  })

  const button = await window.webContents.executeJavaScript('window.ciOpenDialog()')
  const hidden = await waitFor(() => !nativePreview.getWindowState().visible)
  record('a: opening a dialog hides the preview', Boolean(hidden))

  const toScreen = (cssX, cssY) => ({
    x: state.viewerBounds.left + (cssX - bounds.css.left) * bounds.scale,
    y: state.viewerBounds.top + (cssY - bounds.css.top) * bounds.scale,
  })
  const target = toScreen(button.left + button.width / 2, button.top + button.height / 2)
  const ownerUnderDialog = probe('point', target.x, target.y)
  record('a: Windows reports the dialog (BluePLM) on top where the preview was', ownerUnderDialog === process.pid, {
    ownerUnderDialog,
    electron: process.pid,
  })
  probe('click', target.x, target.y)
  const clicked = await waitFor(() => dialogClicks > 0, 5_000)
  record('a: a real mouse click reaches the dialog button', Boolean(clicked), { dialogClicks })

  await window.webContents.executeJavaScript('window.ciCloseDialog()')
  const reshown = await waitFor(() => nativePreview.getWindowState().visible)
  const ownerAfterDialog = reshown ? probe('point', centre.x, centre.y) : 0
  record('a: closing the dialog shows the preview again', Boolean(reshown) && hostIds.includes(ownerAfterDialog), {
    ownerAfterDialog,
  })
  return { window, controller, senderId, sessionId }
}

/** (b) No .NET 8 Desktop Runtime, no embedded preview. */
function checkDesktopRuntime(edrawings) {
  const installed = edrawings.hasDotNet8DesktopRuntime()
  record('b: the installed .NET 8 Desktop Runtime is detected', installed === true)

  const programFiles = path.join(work, 'program-files-without-net8')
  for (const version of ['6.0.36', '7.0.20', '9.0.0']) {
    fs.mkdirSync(path.join(programFiles, 'dotnet', 'shared', 'Microsoft.WindowsDesktop.App', version), { recursive: true })
  }
  const saved = process.env.ProgramW6432
  process.env.ProgramW6432 = programFiles
  let missing
  try {
    missing = edrawings.hasDotNet8DesktopRuntime()
  } finally {
    if (saved === undefined) delete process.env.ProgramW6432
    else process.env.ProgramW6432 = saved
  }
  record('b: other runtimes without .NET 8 are reported as missing', missing === false)
  const available = edrawings.isEDrawingsNativePreviewAvailable({ isAvailable: () => true }, hostPath, missing)
  record('b: the embedded preview is unavailable without .NET 8, even with eDrawings and the host present', available === false)
}

function createShare(directory) {
  const name = `BluePLMCI${process.pid}`
  try {
    powershell([
      '-Command',
      `New-SmbShare -Name '${name}' -Path '${directory}' -FullAccess 'Everyone' | Out-Null`,
    ])
    return { root: `\\\\localhost\\${name}`, remove: () => powershell(['-Command', `Remove-SmbShare -Name '${name}' -Force`]) }
  } catch (error) {
    // The administrative share reaches the same folder over SMB when creating a share is refused.
    console.warn('New-SmbShare failed, using the administrative share:', String(error))
    const drive = directory.slice(0, 1)
    return { root: `\\\\localhost\\${drive}$${directory.slice(2)}`, remove: () => undefined }
  }
}

function installStubViewer() {
  // findEDrawingsExecutable searches these literal folders, not the environment's.
  const commonFiles = 'C:\\Program Files\\Common Files'
  const existing = fs.existsSync(commonFiles)
    ? fs.readdirSync(commonFiles).filter(entry => /^edrawings(?:\d{4})?$/i.test(entry))
    : []
  if (existing.length > 0) throw new Error(`eDrawings is installed here (${existing.join(', ')}); this check runs only on a clean CI machine.`)
  const target = path.join(commonFiles, 'eDrawings2099')
  fs.cpSync(viewerDirectory, target, { recursive: true })
  const remove = () => {
    // A stub still running holds its files open.
    spawnSync('taskkill.exe', ['/F', '/IM', 'eDrawings.exe'], { windowsHide: true })
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
  }
  return { target, remove }
}

/** (c) A vault on a UNC share. */
async function checkUncVault(edrawings, addon, session) {
  const sharedDirectory = path.join(work, 'shared-vault')
  writeSample(sharedDirectory)
  const share = createShare(sharedDirectory)
  const viewer = installStubViewer()
  try {
    const uncFile = `${share.root}\\Parts\\bracket.sldprt`
    record('c: the vault file is reachable over UNC', fs.existsSync(uncFile), { uncFile })

    if (!session.window) {
      record('c: the embedded preview refuses a UNC vault as not local, starting no host', false, 'no BluePLM window from check (a)')
    } else {
      const hostsBefore = previewHostProcessIds()
      // The same wiring as registerEDrawingsHandlers: the configured vault root is the share.
      const uncController = edrawings.createEDrawingsPreviewController({
        // Creating the addon object starts nothing; a host process starts only in loadFile.
        createPreview: () => new addon.EDrawingsPreview(),
        getPreviewHostPath: () => hostPath,
        validateFile: filePath => edrawings.validateEDrawingsPreviewFile(filePath, share.root),
        logWarn: (message, data) => console.warn(message, data ?? ''),
      })
      const created = uncController.create(session.window, session.senderId)
      const loaded = created.success
        ? await uncController.load(created.sessionId, session.senderId, uncFile)
        : created
      const hostsAfter = previewHostProcessIds()
      record(
        'c: the embedded preview refuses a UNC vault as not local, starting no host',
        loaded.success === false &&
          loaded.errorCode === 'preview-vault-not-local' &&
          hostsAfter.length === hostsBefore.length,
        { loaded, hostsBefore, hostsAfter },
      )
      uncController.cleanup()
    }

    const discovered = edrawings.findEDrawingsExecutable()
    record('c: "Open in eDrawings" discovers the installed viewer', discovered === path.join(viewer.target, 'eDrawings.exe'), {
      discovered,
    })
    const checked = edrawings.validateEDrawingsExternalOpenFile(uncFile, share.root)
    record('c: "Open in eDrawings" accepts a file in the UNC vault', checked.success === true, checked)
    if (!checked.success) return

    const log = path.join(work, 'viewer-log.json')
    process.env.BLUEPLM_CI_VIEWER_LOG = log
    const mode = await edrawings.openEDrawingsFileExternally(checked.filePath)
    const readLog = () => {
      try {
        const entry = JSON.parse(fs.readFileSync(log, 'utf8'))
        return entry.stage === 'done' ? entry : null
      } catch {
        return null
      }
    }
    const received = await waitFor(readLog, 60_000)
    if (!received) {
      console.log('viewer log', fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : 'missing')
      console.log('viewer processes', powershell(['-Command', "Get-CimInstance Win32_Process -Filter \"Name='eDrawings.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"]))
    }
    record(
      'c: "Open in eDrawings" starts the viewer on the UNC path, and the viewer can read it',
      mode === 'viewer' && received?.args?.[0] === checked.filePath && received.readable === true,
      { mode, received, expected: checked.filePath },
    )
  } finally {
    viewer.remove()
    share.remove()
  }
}

app.whenReady()
  .then(async () => {
    require('tsx/cjs/api').register()
    const edrawings = require('../../electron/handlers/edrawings.ts')
    const addon = require(addonPath)
    warmUp('preview host', hostPath, [])
    warmUp('stub viewer', path.join(viewerDirectory, 'eDrawings.exe'), [])
    let session = {}
    try {
      session = await checkDialogOverPreview(edrawings, addon)
    } catch (error) {
      record('a: dialog over the embedded preview', false, String(error?.stack ?? error))
    }
    try {
      checkDesktopRuntime(edrawings)
    } catch (error) {
      record('b: .NET 8 Desktop Runtime detection', false, String(error?.stack ?? error))
    }
    try {
      await checkUncVault(edrawings, addon, session)
    } catch (error) {
      record('c: UNC vault', false, String(error?.stack ?? error))
    }
    session.controller?.cleanup()
    fs.writeFileSync(path.join(work, 'results.json'), JSON.stringify(results, null, 2))
    const failed = results.filter(result => !result.passed)
    console.log(`${results.length - failed.length}/${results.length} eDrawings system checks passed`)
    app.exit(failed.length === 0 && results.length > 0 ? 0 : 1)
  })
  .catch(error => {
    console.error(error)
    app.exit(1)
  })
