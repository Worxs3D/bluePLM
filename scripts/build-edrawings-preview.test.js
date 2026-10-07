const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  commandExists,
  formatBytes,
  removeStaleResourceOutput,
  resolveNativeBuildOptions,
} = require('./build-edrawings-preview')

test('keeps desktop pixel diagnostics out of production builds', () => {
  assert.deepEqual(resolveNativeBuildOptions([]), {
    verify: false,
    gypDefine: 'edrawings_verify=0',
  })
})

test('enables desktop pixel diagnostics only for an explicit verify build', () => {
  assert.deepEqual(resolveNativeBuildOptions(['--verify']), {
    verify: true,
    gypDefine: 'edrawings_verify=1',
  })
})

test('treats a command with a nonzero exit status as unavailable', () => {
  assert.equal(commandExists(process.execPath, ['-e', 'process.exit(3)']), false)
})

test('removes only the stale native resource artifact before a skip', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'blueplm-edrawings-'))
  const artifact = path.join(directory, 'edrawings_preview.node')
  const unrelated = path.join(directory, 'keep.txt')
  writeFileSync(artifact, 'stale')
  writeFileSync(unrelated, 'keep')

  removeStaleResourceOutput(artifact)

  assert.equal(existsSync(artifact), false)
  assert.equal(existsSync(unrelated), true)
})

test('formats native payload sizes for build logs', () => {
  assert.equal(formatBytes(1024), '1.0 KiB')
})
