import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The SolidWorks service queue, driven end to end through the real IPC handlers. The
// service itself is a fake child process: it reads the JSON lines the handler writes to
// stdin and answers on stdout with lines shaped by solidworks-service/wire-manifest.json,
// so request-id correlation, timeouts, priorities, cancellation and crash handling all run
// the production code in solidworks.ts.

interface WireManifest {
  commonRequestFields: string[]
  responseFields: string[]
  actions: Record<string, { request: string[] }>
  errorCodes: { service: string[]; comErrorCode: string[]; client: string[] }
}

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../solidworks-service/wire-manifest.json'), 'utf8'),
) as WireManifest

type WireCommand = Record<string, unknown> & { action: string; requestId: number }
type WireResponse = Record<string, unknown>
type Responder = (command: WireCommand) => WireResponse | undefined

class FakeServiceProcess extends EventEmitter {
  readonly pid = process.pid
  killed = false
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly commands: WireCommand[] = []
  readonly killSignals: Array<string | undefined> = []
  responder: Responder = defaultResponder
  readonly stdin = {
    write: (line: string): boolean => {
      const command = JSON.parse(line) as WireCommand
      this.commands.push(command)
      const response = this.responder(command)
      if (response) setImmediate(() => this.reply(command.requestId, response))
      return true
    },
  }

  /** Emit one response line for a request, validated against the wire manifest. */
  reply(requestId: number, response: WireResponse): void {
    this.emitLine({ ...response, requestId })
  }

  emitLine(response: WireResponse): void {
    for (const field of Object.keys(response)) {
      expect(manifest.responseFields, `response field ${field}`).toContain(field)
    }
    this.stdout.emit('data', Buffer.from(JSON.stringify(response) + '\n'))
  }

  kill(signal?: string): boolean {
    this.killed = true
    this.killSignals.push(signal)
    return true
  }

  actions(): string[] {
    return this.commands.map((command) => command.action)
  }

  last(action: string): WireCommand {
    const found = [...this.commands].reverse().find((command) => command.action === action)
    if (!found) throw new Error(`service never received ${action}`)
    return found
  }
}

function defaultResponder(command: WireCommand): WireResponse | undefined {
  if (command.action === 'ping') return { success: true, data: { version: 'test' } }
  return undefined
}

const { spawnMock, execSyncMock, ipcHandlers, state } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execSyncMock: vi.fn(() => {
    throw new Error('no registry in tests')
  }),
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  state: { root: '' },
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler)
    },
    removeHandler: (channel: string) => {
      ipcHandlers.delete(channel)
    },
  },
  app: {
    isPackaged: false,
    getAppPath: () => state.root,
    getPath: () => state.root,
  },
  BrowserWindow: class {},
  shell: {},
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  const mocked = { ...actual, spawn: spawnMock, execSync: execSyncMock }
  return { ...mocked, default: mocked }
})

vi.mock('./swProcess/query', () => ({
  querySwProcesses: async () => ({ processes: [], source: 'tasklist' }),
  querySwProcessStartTime: async () => null,
  requestSwProcessClose: async () => {},
}))

type SolidWorksModule = typeof import('./solidworks')
type SwResult = { success: boolean; error?: string; errorCode?: string; data?: unknown }

let sw: SolidWorksModule
let children: FakeServiceProcess[]
let sendToRenderer: ReturnType<typeof vi.fn>

function invoke<T = SwResult>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`${channel} was never registered`)
  return Promise.resolve(handler(null, ...args) as T)
}

function currentChild(): FakeServiceProcess {
  const child = children[children.length - 1]
  if (!child) throw new Error('service was never spawned')
  return child
}

/** Let setImmediate replies and the promise chains behind them run. */
async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve))
}

async function startService(): Promise<FakeServiceProcess> {
  const result = await invoke('solidworks:start-service')
  expect(result.success).toBe(true)
  return currentChild()
}

/** Responder that holds every non-ping command so the test decides when each one finishes. */
function holdAll(): Responder {
  return defaultResponder
}

beforeEach(async () => {
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'blueplm-swqueue-'))
  const exeDir = path.join(state.root, 'solidworks-service', 'BluePLM.SolidWorksService', 'bin', 'Release')
  fs.mkdirSync(exeDir, { recursive: true })
  fs.writeFileSync(path.join(exeDir, 'BluePLM.SolidWorksService.exe'), '')

  children = []
  spawnMock.mockReset()
  spawnMock.mockImplementation(() => {
    const child = new FakeServiceProcess()
    children.push(child)
    return child
  })
  ipcHandlers.clear()

  vi.resetModules()
  sw = await import('./solidworks')
  sendToRenderer = vi.fn()
  const window = { isDestroyed: () => false, webContents: { send: sendToRenderer } }
  sw.registerSolidWorksHandlers(window as unknown as Electron.BrowserWindow, {
    log: () => {},
    logError: () => {},
    logWarn: () => {},
  })
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const child of children) child.responder = () => ({ success: true })
  await sw.cleanupSolidWorksService()
  fs.rmSync(state.root, { recursive: true, force: true })
})

describe('service start', () => {
  it('spawns the service and confirms it with a ping carrying a request id', async () => {
    const child = await startService()

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(String(spawnMock.mock.calls[0][0])).toMatch(/BluePLM\.SolidWorksService\.exe$/)
    const ping = child.last('ping')
    expect(typeof ping.requestId).toBe('number')
    // Every field the client sends is in the manifest
    for (const field of Object.keys(ping)) {
      expect([...manifest.commonRequestFields, ...manifest.actions.ping.request]).toContain(field)
    }
  })

  it('reports a missing build instead of spawning', async () => {
    fs.rmSync(path.join(state.root, 'solidworks-service'), { recursive: true })
    const result = await invoke('solidworks:start-service')
    expect(result).toMatchObject({ success: false, error: 'SolidWorks service not built' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('refuses commands while no service is running', async () => {
    const result = await invoke('solidworks:get-properties', 'C:/Vault/a.sldprt')
    expect(result).toEqual({
      success: false,
      error: 'SolidWorks service not running. Start it first.',
    })
  })

  it('does not spawn a second service while the first is healthy', async () => {
    await startService()
    const again = await invoke('solidworks:start-service')
    expect(again).toMatchObject({ success: true, data: { message: 'Service already running' } })
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })
})

describe('response correlation', () => {
  it('hands each response to the request with its id, whatever order they arrive in', async () => {
    const child = await startService()
    child.responder = holdAll()

    const props = invoke('solidworks:get-properties', 'C:/Vault/a.sldprt')
    await settle()
    const propsCommand = child.last('getProperties')

    // A ping bypasses the queue, so it is in flight alongside the property read
    child.responder = () => undefined
    const ping = sw.sendSWCommand({ action: 'ping' })
    await settle()
    const pingCommand = child.last('ping')

    child.reply(pingCommand.requestId, { success: true, data: { version: 'ping-answer' } })
    child.reply(propsCommand.requestId, {
      success: true,
      data: { fileProperties: { Number: 'BR-1' } },
    })

    await expect(ping).resolves.toMatchObject({ data: { version: 'ping-answer' } })
    await expect(props).resolves.toMatchObject({ data: { fileProperties: { Number: 'BR-1' } } })
  })

  it('reassembles a response split across stdout chunks and splits two in one chunk', async () => {
    const child = await startService()
    child.responder = holdAll()

    const first = invoke('solidworks:get-properties', 'C:/Vault/a.sldprt')
    await settle()
    const firstId = child.last('getProperties').requestId
    const line = JSON.stringify({ success: true, data: { fileProperties: { a: '1' } }, requestId: firstId })
    child.stdout.emit('data', Buffer.from(line.slice(0, 17)))
    child.stdout.emit('data', Buffer.from(line.slice(17) + '\n'))
    await expect(first).resolves.toMatchObject({ data: { fileProperties: { a: '1' } } })

    child.responder = () => undefined
    const pingA = sw.sendSWCommand({ action: 'ping' })
    const pingB = sw.sendSWCommand({ action: 'ping' })
    await settle()
    const [idA, idB] = child.commands.filter((c) => c.action === 'ping').slice(-2).map((c) => c.requestId)
    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({ success: true, data: { version: 'B' }, requestId: idB }) +
          '\n' +
          JSON.stringify({ success: true, data: { version: 'A' }, requestId: idA }) +
          '\n',
      ),
    )
    await expect(pingA).resolves.toMatchObject({ data: { version: 'A' } })
    await expect(pingB).resolves.toMatchObject({ data: { version: 'B' } })
  })

  it('survives an unparseable line and keeps reading the stream', async () => {
    const child = await startService()
    child.responder = holdAll()

    const props = invoke('solidworks:get-properties', 'C:/Vault/a.sldprt')
    await settle()
    child.stdout.emit('data', Buffer.from('Unhandled exception: not json\n'))
    child.reply(child.last('getProperties').requestId, { success: true, data: {} })
    await expect(props).resolves.toMatchObject({ success: true })
  })

  it('discards a late answer to a timed-out request instead of giving it to the next caller', async () => {
    const child = await startService()
    child.responder = holdAll()
    // No retry jitter: the retry goes out exactly 1000ms after the first attempt times out
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const slow = sw.sendSWCommand({ action: 'getProperties', filePath: 'C:/Vault/slow.sldprt' }, { timeoutMs: 100 })
    await vi.advanceTimersByTimeAsync(0)
    const timedOutId = child.last('getProperties').requestId

    // TIMEOUT is retryable: the first attempt gives up, then the command is sent again
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(1_000)
    const retry = child.last('getProperties')
    expect(retry.requestId).not.toBe(timedOutId)

    // A ping is waiting when the stale answer for the first attempt finally arrives
    child.responder = () => undefined
    const ping = sw.sendSWCommand({ action: 'ping' })
    await vi.advanceTimersByTimeAsync(0)
    child.reply(timedOutId, { success: false, error: 'export failed late' })
    child.reply(child.last('ping').requestId, { success: true, data: { version: 'fresh' } })
    child.reply(retry.requestId, { success: true, data: { fileProperties: { ok: 'yes' } } })
    vi.useRealTimers()
    await settle()

    await expect(ping).resolves.toMatchObject({ success: true, data: { version: 'fresh' } })
    await expect(slow).resolves.toMatchObject({ success: true, data: { fileProperties: { ok: 'yes' } } })
  })
})

describe('error codes and retries', () => {
  it('passes a service error code through without retrying and tells the renderer once', async () => {
    const child = await startService()
    child.responder = (command) =>
      command.action === 'setProperties'
        ? { success: false, error: 'File is read-only', errorCode: 'DM_FILE_READ_ONLY' }
        : defaultResponder(command)

    const result = await invoke('solidworks:set-properties', 'C:/Vault/a.sldprt', { Number: 'BR-1' })

    expect(manifest.errorCodes.service).toContain('DM_FILE_READ_ONLY')
    expect(result).toMatchObject({ success: false, errorCode: 'DM_FILE_READ_ONLY' })
    expect(child.actions().filter((action) => action === 'setProperties')).toHaveLength(1)
    const errors = sendToRenderer.mock.calls.filter(([channel]) => channel === 'solidworks:error')
    expect(errors).toHaveLength(1)
    expect(errors[0][1]).toMatchObject({ operation: 'setProperties', filePath: 'C:/Vault/a.sldprt' })
  })

  it('retries a busy SolidWorks twice, then reports the last failure', async () => {
    const child = await startService()
    child.responder = (command) =>
      command.action === 'getProperties'
        ? { success: false, error: 'Call was rejected by callee', errorCode: 'SwBusy' }
        : defaultResponder(command)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const result = sw.sendSWCommand({ action: 'getProperties', filePath: 'C:/Vault/a.sldprt' })
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(1_000)
      await new Promise((resolve) => setImmediate(resolve))
    }

    await expect(result).resolves.toMatchObject({ success: false, errorCode: 'SwBusy' })
    expect(child.actions().filter((action) => action === 'getProperties')).toHaveLength(3)
    expect(
      sendToRenderer.mock.calls.filter(([channel]) => channel === 'solidworks:error'),
    ).toHaveLength(1)
  })
})

describe('queue order', () => {
  it('runs interactive work first, previews next and bulk reads last, FIFO within each', async () => {
    const child = await startService()
    child.responder = holdAll()

    const blocker = invoke('solidworks:get-properties-document-manager', 'C:/Vault/blocker.sldprt')
    await settle()

    const queued = [
      invoke('solidworks:get-properties-document-manager', 'C:/Vault/bulk.sldprt'),
      invoke('solidworks:get-references', 'C:/Vault/bg.sldasm'),
      invoke('solidworks:get-preview', 'C:/Vault/preview.sldprt'),
      invoke('solidworks:get-properties', 'C:/Vault/clicked.sldprt'),
      invoke('solidworks:get-references', 'C:/Vault/fg.sldasm', 'foreground'),
    ]
    await settle()
    expect(child.commands.filter((c) => c.action !== 'ping')).toHaveLength(1)

    // Answer whatever is in flight, one at a time, recording the order they were sent
    const order: string[] = []
    let answered = child.commands.length
    child.reply(child.commands[answered - 1].requestId, { success: true, data: {} })
    for (let i = 0; i < queued.length; i++) {
      await settle()
      const next = child.commands[answered]
      expect(next, `command ${i} was dispatched`).toBeDefined()
      order.push(`${next.action}:${path.basename(String(next.filePath))}`)
      answered++
      child.reply(next.requestId, { success: true, data: {} })
    }

    await Promise.all([blocker, ...queued])
    expect(order).toEqual([
      'getProperties:clicked.sldprt',
      'getReferences:fg.sldasm',
      'getPreview:preview.sldprt',
      'getPropertiesDocumentManager:bulk.sldprt',
      'getReferences:bg.sldasm',
    ])
  })

  it('defaults a reference read without an origin to background', async () => {
    const child = await startService()
    child.responder = (command) => (command.action === 'ping' ? defaultResponder(command) : { success: true, data: {} })

    await invoke('solidworks:get-references', 'C:/Vault/a.sldasm')
    expect(child.last('getReferences').origin).toBe('background')
    await invoke('solidworks:get-references', 'C:/Vault/a.sldasm', 'nonsense')
    expect(child.last('getReferences').origin).toBe('background')
  })
})

describe('cancellation', () => {
  it('drops queued background reference reads and keeps foreground ones', async () => {
    const child = await startService()
    child.responder = holdAll()

    const blocker = invoke('solidworks:get-properties', 'C:/Vault/blocker.sldprt')
    await settle()
    const bg1 = invoke('solidworks:get-references', 'C:/Vault/bg1.sldasm')
    const bg2 = invoke('solidworks:get-references', 'C:/Vault/bg2.sldasm', 'background')
    const fg = invoke('solidworks:get-references', 'C:/Vault/fg.sldasm', 'foreground')

    await expect(invoke('solidworks:cancel-background-references', 'new batch')).resolves.toEqual({
      cancelledCount: 2,
    })
    await expect(bg1).resolves.toEqual({ success: false, error: 'Cancelled: new batch' })
    await expect(bg2).resolves.toEqual({ success: false, error: 'Cancelled: new batch' })

    child.responder = () => ({ success: true, data: {} })
    child.reply(child.last('getProperties').requestId, { success: true, data: {} })
    await expect(blocker).resolves.toMatchObject({ success: true })
    await expect(fg).resolves.toMatchObject({ success: true })
    expect(child.commands.filter((c) => c.action === 'getReferences').map((c) => c.filePath)).toEqual([
      'C:/Vault/fg.sldasm',
    ])
  })

  it('cancels previews under a folder regardless of separator and case, not its prefix siblings', async () => {
    const child = await startService()
    child.responder = holdAll()

    const blocker = invoke('solidworks:get-properties', 'C:/Vault/blocker.sldprt')
    await settle()
    const inside = invoke('solidworks:get-preview', 'C:\\Vault\\Parts\\a.sldprt')
    const nested = invoke('solidworks:get-preview', 'c:/vault/parts/sub/b.sldprt')
    const sibling = invoke('solidworks:get-preview', 'C:\\Vault\\Parts2\\c.sldprt')
    const props = invoke('solidworks:get-properties', 'C:\\Vault\\Parts\\d.sldprt')

    const result = await invoke<{ cancelledCount: number; activeCount: number }>(
      'sw:cancel-previews-for-folder',
      'C:/Vault/Parts',
    )
    expect(result).toMatchObject({ cancelledCount: 2, activeCount: 0 })
    await expect(inside).resolves.toMatchObject({ success: false, error: 'Cancelled: folder being moved' })
    await expect(nested).resolves.toMatchObject({ success: false })

    // Navigating to Parts2 drops what is left outside it, but never non-preview work
    const stale = await invoke<{ cancelledCount: number }>('sw:cancel-previews', 'C:/Vault/Parts2')
    expect(stale.cancelledCount).toBe(0)

    child.responder = () => ({ success: true, data: {} })
    child.reply(child.last('getProperties').requestId, { success: true, data: {} })
    await Promise.all([blocker, sibling, props])
    await expect(sibling).resolves.toMatchObject({ success: true })
    await expect(props).resolves.toMatchObject({ success: true })
  })
})

describe('crash and restart', () => {
  it('fails in-flight and queued work when the service exits, then refuses new work', async () => {
    const child = await startService()
    child.responder = holdAll()

    const inFlight = invoke('solidworks:get-properties', 'C:/Vault/a.sldprt')
    await settle()
    const queued = invoke('solidworks:get-configurations', 'C:/Vault/b.sldprt')

    child.emit('close', 3, null)

    await expect(inFlight).resolves.toMatchObject({ success: false, error: 'Request rejected' })
    await expect(queued).resolves.toEqual({
      success: false,
      error: 'Process exited (code: 3, signal: null)',
    })
    await expect(invoke('solidworks:get-properties', 'C:/Vault/a.sldprt')).resolves.toMatchObject({
      success: false,
      error: 'SolidWorks service not running. Start it first.',
    })

    // And it can be started again
    const second = await startService()
    expect(second).not.toBe(child)
  })

  it('keeps the service when a stdio error fires but the process is still alive', async () => {
    const child = await startService()
    child.emit('error', new Error('EPIPE'))

    child.responder = (command) => ({ success: true, data: { action: command.action } })
    await expect(invoke('solidworks:get-properties', 'C:/Vault/a.sldprt')).resolves.toMatchObject({
      success: true,
    })
  })

  it('force-restart kills the old process and the new service survives the old one exiting', async () => {
    const first = await startService()
    first.responder = holdAll()
    const inFlight = invoke('solidworks:get-properties', 'C:/Vault/a.sldprt')
    await settle()

    const restarted = await invoke('solidworks:force-restart')
    expect(restarted.success).toBe(true)
    expect(first.killSignals).toEqual(['SIGKILL'])
    await expect(inFlight).resolves.toMatchObject({ success: false, error: 'Request rejected' })

    // The killed process reports its exit only now, after its replacement is up
    first.emit('close', null, 'SIGKILL')

    const second = currentChild()
    expect(second).not.toBe(first)
    second.responder = (command) => ({ success: true, data: { action: command.action } })
    await expect(invoke('solidworks:get-properties', 'C:/Vault/b.sldprt')).resolves.toMatchObject({
      success: true,
    })
  })

  it('stop-service sends quit and kills the process', async () => {
    const child = await startService()
    child.responder = (command) => (command.action === 'quit' ? { success: true } : defaultResponder(command))

    await expect(invoke('solidworks:stop-service')).resolves.toEqual({ success: true })
    expect(child.actions()).toContain('quit')
    expect(child.killed).toBe(true)
  })
})
