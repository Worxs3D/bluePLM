const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { directorySize, formatBytes } = require('./build-edrawings-preview-host')

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
