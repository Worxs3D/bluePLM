const assert = require('node:assert/strict')
const { existsSync, mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  commandExists,
  directorySize,
  formatBytes,
  removeStaleResourceOutput,
} = require('./build-edrawings-preview-host')

test('treats a command with a nonzero exit status as unavailable', () => {
  assert.equal(commandExists(process.execPath, ['-e', 'process.exit(3)']), false)
})

test('removes a stale host payload before a toolchain skip', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'blueplm-edrawings-host-resource-'))
  writeFileSync(path.join(directory, 'stale.exe'), 'stale')

  removeStaleResourceOutput(directory)

  assert.equal(existsSync(directory), false)
})

test('measures the complete host payload recursively', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'blueplm-edrawings-host-'))
  mkdirSync(path.join(directory, 'nested'))
  writeFileSync(path.join(directory, 'host.exe'), '1234')
  writeFileSync(path.join(directory, 'nested', 'runtimeconfig.json'), '123')

  assert.equal(directorySize(directory), 7)
})

test('formats host payload sizes for build logs', () => {
  assert.equal(formatBytes(1024 * 1024), '1.0 MiB')
})
