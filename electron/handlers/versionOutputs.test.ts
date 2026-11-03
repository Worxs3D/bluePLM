import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import type { AddressInfo } from 'net'
import os from 'os'
import path from 'path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  shell: { openPath: vi.fn() },
}))

const { downloadVerified, safeOutputName } = await import('./versionOutputs')

describe('safeOutputName', () => {
  it('keeps a plain output name', () => {
    expect(safeOutputName('BR-101011_RevA.step')).toBe('BR-101011_RevA.step')
    expect(safeOutputName('Drawing.PDF')).toBe('Drawing.pdf')
  })

  it('drops folders and characters Windows refuses', () => {
    expect(safeOutputName('..\\..\\Windows\\evil.pdf')).toBe('evil.pdf')
    expect(safeOutputName('a/b/x:y?.stl')).toBe('x_y_.stl')
    expect(safeOutputName('...hidden.dxf')).toBe('hidden.dxf')
  })

  it('refuses anything that is not an output file', () => {
    expect(safeOutputName('run.exe')).toBeNull()
    expect(safeOutputName('script.pdf.bat')).toBeNull()
    expect(safeOutputName('noextension')).toBeNull()
    expect(safeOutputName(42)).toBeNull()
  })
})

describe('downloadVerified', () => {
  const body = Buffer.from('STEP output bytes')
  const sha = crypto.createHash('sha256').update(body).digest('hex')
  let server: http.Server
  let url = ''
  let dir = ''

  beforeAll(async () => {
    server = http.createServer((_req, res) => res.end(body))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/o`
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vo-test-'))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.promises.rm(dir, { recursive: true, force: true })
  })

  it('writes the file when the hash matches', async () => {
    const target = path.join(dir, 'ok.step')
    await expect(downloadVerified(url, target, sha)).resolves.toBe(body.length)
    expect(await fs.promises.readFile(target)).toEqual(body)
  })

  it('removes the file on a wrong hash', async () => {
    const target = path.join(dir, 'bad.step')
    await expect(downloadVerified(url, target, '0'.repeat(64))).rejects.toThrow(/hash/)
    expect(fs.existsSync(target)).toBe(false)
  })

  it('rejects (never hangs) when the file cannot be written', async () => {
    const target = path.join(dir, 'missing-folder', 'x.step')
    await expect(downloadVerified(url, target, sha)).rejects.toThrow()
    expect(fs.existsSync(target)).toBe(false)
  })
})
