const { spawnSync } = require('node:child_process')
const path = require('node:path')

const NODE_BUILD_TESTS = [
  'scripts/build-edrawings-preview-host.test.js',
  'scripts/build-edrawings-preview.test.js',
  'scripts/verify-edrawings-preview-artifacts.test.js',
]

function runNode(args, env = process.env) {
  const result = spawnSync(process.execPath, args, {
    cwd: path.resolve(__dirname, '..'),
    env,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

function main() {
  const inheritedOptions = process.env.NODE_OPTIONS?.trim()
  const webStorageOption = '--no-experimental-webstorage'
  const nodeOptions = inheritedOptions?.includes(webStorageOption)
    ? inheritedOptions
    : [inheritedOptions, webStorageOption].filter(Boolean).join(' ')
  const vitestPath = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
  const vitestStatus = runNode([vitestPath, 'run'], {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
  })
  if (vitestStatus !== 0) return vitestStatus
  return runNode(['--test', ...NODE_BUILD_TESTS])
}

if (require.main === module) process.exitCode = main()

module.exports = { main, runNode }
