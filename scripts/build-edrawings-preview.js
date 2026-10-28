/* Build the optional Windows native eDrawings preview module for Electron. */
const { execFileSync, spawnSync } = require('node:child_process')
const { copyFileSync, existsSync, mkdirSync, rmSync, statSync } = require('node:fs')
const path = require('node:path')
const { resolveNpmInvocation } = require('./resolve-npm-invocation')

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

function commandExists(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore', windowsHide: true })
  return !result.error && result.status === 0
}

function hasVisualCppToolchain({
  environment = process.env,
  fileExists = existsSync,
  spawn = spawnSync,
} = {}) {
  const vswhere = path.join(
    environment['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe',
  )
  if (!fileExists(vswhere)) return false

  const result = spawn(
    vswhere,
    [
      '-latest',
      '-products',
      '*',
      // node-gyp 10.3.1 supports VS2019 (16.x) and VS2022 (17.x), not VS2026.
      '-version',
      '[16.0,18.0)',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  return !result.error && result.status === 0 && result.stdout.trim().length > 0
}

function removeStaleResourceOutput(resourceFile) {
  rmSync(resourceFile, { force: true })
}

function resolveNativeBuildOptions(args, environment = process.env) {
  const verify = args.includes('--verify')
  const releaseBuild = environment.BLUEPLM_EDRAWINGS_RELEASE_BUILD === '1'
  return {
    verify,
    required: verify || releaseBuild,
    gypDefine: `edrawings_verify=${verify ? 1 : 0}`,
  }
}

function createSystemBuildDependencies() {
  const root = path.resolve(__dirname, '..')
  return {
    root,
    platform: process.platform,
    execPath: process.execPath,
    existsSync,
    commandExists,
    hasVisualCppToolchain,
    removeStaleResourceOutput,
    resolveNpmInvocation,
    execFileSync,
    mkdirSync,
    copyFileSync,
    statSync,
    getElectronVersion: () =>
      require(path.join(root, 'node_modules', 'electron', 'package.json')).version,
    warn: (message) => console.warn(`[eDrawings] ${message}`),
    log: (message) => console.log(message),
  }
}

function buildNativePreview(
  args,
  environment = process.env,
  dependencies = createSystemBuildDependencies(),
) {
  const buildOptions = resolveNativeBuildOptions(args, environment)
  const { root } = dependencies
  const nativeDirectory = path.join(root, 'native')
  const resourceDirectory = path.join(root, 'resources', 'bin', 'win32')
  const resourceFile = path.join(resourceDirectory, 'edrawings_preview.node')
  dependencies.removeStaleResourceOutput(resourceFile)

  const missingPrerequisite = (reason) => {
    if (buildOptions.required) {
      throw new Error(`Required eDrawings native preview build cannot continue: ${reason}`)
    }
    dependencies.warn(`Skipping optional native preview: ${reason}`)
    return false
  }

  if (dependencies.platform !== 'win32') {
    return missingPrerequisite('it is supported only on Windows.')
  }

  if (
    !dependencies.commandExists('python.exe', ['--version']) &&
    !dependencies.commandExists('py.exe', ['-3', '--version'])
  ) {
    return missingPrerequisite(
      'Python 3 was not found; install it before building the optional node-gyp addon.',
    )
  }

  if (!dependencies.hasVisualCppToolchain()) {
    return missingPrerequisite('Visual Studio Build Tools with the C++ workload were not found.')
  }

  let gypEntrypoint = path.join(nativeDirectory, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
  if (!dependencies.existsSync(gypEntrypoint)) {
    const { command, args: npmArgs } = dependencies.resolveNpmInvocation(
      dependencies.platform,
      environment,
    )
    // Keep the cmd.exe npm bootstrap: it is required for Node 25 on Windows.
    dependencies.execFileSync(command, npmArgs, { cwd: nativeDirectory, stdio: 'inherit' })
    gypEntrypoint = path.join(nativeDirectory, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
  }

  if (!dependencies.existsSync(gypEntrypoint)) {
    throw new Error(`node-gyp bootstrap completed without producing ${gypEntrypoint}`)
  }

  const output = path.join(nativeDirectory, 'build', 'Release', 'edrawings_preview.node')
  const electronVersion = dependencies.getElectronVersion()
  dependencies.execFileSync(
    dependencies.execPath,
    [
      gypEntrypoint,
      'rebuild',
      `--target=${electronVersion}`,
      '--arch=x64',
      '--dist-url=https://electronjs.org/headers',
    ],
    {
      cwd: nativeDirectory,
      env: {
        ...environment,
        GYP_DEFINES: `${environment.GYP_DEFINES ?? ''} ${buildOptions.gypDefine}`.trim(),
      },
      stdio: 'inherit',
    },
  )

  if (!dependencies.existsSync(output)) {
    throw new Error(`node-gyp completed without producing ${output}`)
  }

  dependencies.mkdirSync(resourceDirectory, { recursive: true })
  dependencies.copyFileSync(output, resourceFile)
  const buildKind = buildOptions.verify ? 'verify-only diagnostic' : 'production'
  dependencies.log(
    `[eDrawings] Built ${buildKind} native preview module for Electron ${electronVersion} (${formatBytes(dependencies.statSync(resourceFile).size)}).`,
  )
  return true
}

function main() {
  return buildNativePreview(process.argv.slice(2))
}

if (require.main === module) main()

module.exports = {
  commandExists,
  formatBytes,
  hasVisualCppToolchain,
  removeStaleResourceOutput,
  resolveNativeBuildOptions,
  buildNativePreview,
}
