const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  HOST_FILES,
  PACKAGED_PAYLOAD_DIRECTORY,
  SOURCE_PAYLOAD_DIRECTORY,
  verifyPackagedPayload,
  verifyPayload,
} = require('./verify-edrawings-preview-artifacts')

function writePayload(directory) {
  mkdirSync(path.join(directory, 'edrawings-preview-host'))
  writeFileSync(path.join(directory, 'edrawings_preview.node'), 'addon')
  HOST_FILES.forEach(file => writeFileSync(path.join(directory, 'edrawings-preview-host', file), file))
}

test('verifies a complete framework-dependent preview payload', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'blueplm-edrawings-artifacts-'))
  writePayload(directory)

  const payload = verifyPayload(directory)

  assert.equal(payload.addonBytes, 5)
  assert.ok(payload.hostBytes > 0)
})

test('rejects a stale partial payload', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'blueplm-edrawings-artifacts-'))
  writePayload(directory)

  const missing = path.join(directory, 'edrawings-preview-host', 'BluePLM.EDrawingsPreviewHost.runtimeconfig.json')
  rmSync(missing)

  assert.throws(() => verifyPayload(directory), /Missing required eDrawings artifact/)
})

test('rejects a missing fresh native addon', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'blueplm-edrawings-artifacts-'))
  writePayload(directory)
  rmSync(path.join(directory, 'edrawings_preview.node'))

  assert.throws(() => verifyPayload(directory), /Missing required eDrawings artifact/)
})

test('rejects a packaged payload left over from another build', () => {
  const source = mkdtempSync(path.join(tmpdir(), 'blueplm-edrawings-source-'))
  const packaged = mkdtempSync(path.join(tmpdir(), 'blueplm-edrawings-packaged-'))
  writePayload(source)
  writePayload(packaged)
  writeFileSync(path.join(packaged, 'edrawings-preview-host', 'BluePLM.EDrawingsPreviewHost.dll'), 'stale')

  assert.throws(() => verifyPackagedPayload(source, packaged), /does not match the fresh build/)
})

test('uses Electron Builder\'s unpacked Windows resource layout', () => {
  assert.deepEqual(SOURCE_PAYLOAD_DIRECTORY, ['resources', 'bin', 'win32'])
  assert.deepEqual(PACKAGED_PAYLOAD_DIRECTORY, ['release', 'win-unpacked', 'resources', 'bin'])
})
