/* global __dirname, console, process, require */
/* eslint-disable @typescript-eslint/no-require-imports -- Plain Node driver for the Electron CI harness. */
/*
 * Builds what scripts/edrawings-ci/system-check.cjs needs and runs it in Electron:
 * the verify build of the native addon (it adds getWindowState), the preview host built with
 * EDRAWINGS_TEST_SURFACE, and a stub eDrawings.exe. CI only: the check installs that stub
 * under Program Files and creates an SMB share, which must never happen on a workstation.
 * `npm run test:edrawings-system` in the eDrawings Windows job of ci.yml.
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? 'no status'}`)
}

if (process.platform !== 'win32') {
  console.error('The eDrawings system check runs only on Windows.')
  process.exit(1)
}
if (process.env.CI !== 'true') {
  console.error('The eDrawings system check runs only in CI: it installs a stub eDrawings and creates an SMB share.')
  process.exit(1)
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'blueplm-edrawings-ci-'))
const buildScript = path.join(root, 'scripts', 'build-edrawings-preview.js')
let exitCode = 1
try {
  run(process.execPath, [buildScript, '--verify'])
  const addon = path.join(work, 'edrawings_preview.node')
  fs.copyFileSync(path.join(root, 'resources', 'bin', 'win32', 'edrawings_preview.node'), addon)
  run('dotnet', [
    'publish',
    path.join(root, 'edrawings-preview-host-ci', 'BluePLM.EDrawingsPreviewHost.TestSurface.csproj'),
    '-c', 'Release', '-r', 'win-x64', '--self-contained', 'false', '-o', path.join(work, 'host'),
  ])
  run('dotnet', [
    'publish',
    path.join(root, 'edrawings-preview-host-ci', 'stub-viewer', 'BluePLM.EDrawingsStubViewer.csproj'),
    '-c', 'Release', '-o', path.join(work, 'viewer'),
  ])
  const result = spawnSync(require('electron'), [path.join(__dirname, 'system-check.cjs')], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      BLUEPLM_CI_WORK: work,
      BLUEPLM_CI_ADDON: addon,
      BLUEPLM_CI_HOST: path.join(work, 'host', 'BluePLM.EDrawingsPreviewHost.exe'),
      BLUEPLM_CI_VIEWER_DIR: path.join(work, 'viewer'),
    },
  })
  if (result.error) throw result.error
  exitCode = result.status ?? 1
} finally {
  // Never leave the verify-only build in the production resource path.
  run(process.execPath, [buildScript])
}
process.exit(exitCode)
