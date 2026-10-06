const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { formatBytes, removeStaleResourceOutput } = require('./build-edrawings-preview')

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
