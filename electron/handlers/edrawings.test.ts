import { EventEmitter } from 'node:events'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  shell: { openPath: vi.fn() },
}))

import {
  createEDrawingsPreviewController,
  findEDrawingsExecutable,
  getEDrawingsNativeModuleCandidates,
  getEDrawingsPreviewHostCandidates,
  type NativeEDrawingsPreview,
  type PreviewOwner,
  validateEDrawingsPreviewFile,
} from './edrawings'

class FakePreview implements NativeEDrawingsPreview {
  attachCalls = 0
  destroyCalls = 0
  hideCalls = 0
  loadCalls = 0
  setBoundsCalls = 0
  showCalls = 0
  loadResult: boolean | Promise<boolean> = true

  attachToWindow(): boolean {
    this.attachCalls += 1
    return true
  }

  loadFile(): boolean | Promise<boolean> {
    this.loadCalls += 1
    return this.loadResult
  }

  setBounds(): boolean {
    this.setBoundsCalls += 1
    return true
  }

  show(): boolean {
    this.showCalls += 1
    return true
  }

  hide(): boolean {
    this.hideCalls += 1
    return true
  }

  destroy(): boolean {
    this.destroyCalls += 1
    return true
  }

  lastError(): string {
    return 'native failure'
  }
}

class FakeOwner extends EventEmitter implements PreviewOwner {
  private readonly rendererEvents = new EventEmitter()
  webContents: PreviewOwner['webContents']

  constructor(id: number) {
    super()
    this.webContents = {
      id,
      isDestroyed: () => false,
      on: (event, listener) => this.rendererEvents.on(event, listener),
      removeListener: (event, listener) => this.rendererEvents.removeListener(event, listener),
    }
  }

  getNativeWindowHandle(): Buffer {
    return Buffer.from([1, 2, 3, 4])
  }

  isDestroyed(): boolean {
    return false
  }

  isMinimized(): boolean {
    return false
  }

  isVisible(): boolean {
    return true
  }

  emitRendererLifecycle(event: 'render-process-gone' | 'did-start-navigation'): void {
    this.rendererEvents.emit(event)
  }
}

function createController(previews: FakePreview[]) {
  let nextId = 0
  return createEDrawingsPreviewController({
    createPreview: () => previews.shift() ?? null,
    createSessionId: () => `session-${++nextId}`,
    getPreviewHostPath: () => 'C:\\resources\\BluePLM.EDrawingsPreviewHost.exe',
    validateFile: (filePath) =>
      typeof filePath === 'string'
        ? { success: true, filePath }
        : { success: false, error: 'invalid file' },
    logWarn: vi.fn(),
  })
}

describe('findEDrawingsExecutable', () => {
  it('finds the current Common Files eDrawings year layout', () => {
    const expected = 'C:\\Program Files\\Common Files\\eDrawings2026\\eDrawings.exe'
    expect(findEDrawingsExecutable({
      exists: (candidate) => candidate === expected,
      listDirectories: (parent) => parent === 'C:\\Program Files\\Common Files' ? ['eDrawings2026'] : [],
    })).toBe(expected)
  })

  it('continues to support the historic SOLIDWORKS Corp layout', () => {
    const expected = 'C:\\Program Files\\SOLIDWORKS Corp\\eDrawings\\eDrawings.exe'
    expect(findEDrawingsExecutable({
      exists: (candidate) => candidate === expected,
      listDirectories: () => [],
    })).toBe(expected)
  })
})

describe('embedded eDrawings preview controller', () => {
  it('binds every operation to the creating renderer and cannot let a stale session destroy a successor', async () => {
    const previewA = new FakePreview()
    const previewB = new FakePreview()
    const controller = createController([previewA, previewB])
    const owner = new FakeOwner(17)

    const createdA = controller.create(owner, 17)
    expect(createdA).toEqual({ success: true, sessionId: 'session-1' })
    expect(await controller.attach(createdA.sessionId, 17)).toEqual({ success: true })
    await expect(controller.load(createdA.sessionId, 17, 'C:\\vault\\part.sldprt')).resolves.toEqual({
      success: true,
      accepted: true,
      ready: false,
    })
    expect(await controller.hide(createdA.sessionId, 18)).toMatchObject({ success: false })
    expect(previewA.hideCalls).toBe(0)

    const createdB = controller.create(owner, 17)
    expect(createdB).toEqual({ success: true, sessionId: 'session-2' })
    expect(previewA.destroyCalls).toBe(1)
    expect(await controller.destroy(createdA.sessionId, 17)).toMatchObject({ success: false })
    expect(previewB.destroyCalls).toBe(0)
  })

  it('returns stale when a delayed older load resolves after a newer session supersedes it', async () => {
    let resolveLoad: (accepted: boolean) => void = () => undefined
    const previewA = new FakePreview()
    previewA.loadResult = new Promise<boolean>((resolve) => {
      resolveLoad = resolve
    })
    const previewB = new FakePreview()
    const controller = createController([previewA, previewB])
    const owner = new FakeOwner(17)
    const createdA = controller.create(owner, 17)
    const loadingA = controller.load(createdA.sessionId, 17, 'C:\\vault\\part.sldprt')

    const createdB = controller.create(owner, 17)
    resolveLoad(true)

    await expect(loadingA).resolves.toMatchObject({ success: false })
    expect(previewA.destroyCalls).toBe(1)
    expect(await controller.attach(createdB.sessionId, 17)).toEqual({ success: true })
    expect(previewB.attachCalls).toBe(1)
  })

  it.each(['render-process-gone', 'did-start-navigation'] as const)(
    'destroys the preview when the renderer emits %s',
    async (event) => {
      const preview = new FakePreview()
      const controller = createController([preview])
      const owner = new FakeOwner(17)
      const created = controller.create(owner, 17)

      owner.emitRendererLifecycle(event)

      expect(preview.destroyCalls).toBe(1)
      await expect(controller.show(created.sessionId, 17)).resolves.toMatchObject({ success: false })
    },
  )

  it('destroys the preview when its owning window closes', async () => {
    const preview = new FakePreview()
    const controller = createController([preview])
    const owner = new FakeOwner(17)
    const created = controller.create(owner, 17)

    owner.emit('closed')

    expect(preview.destroyCalls).toBe(1)
    await expect(controller.hide(created.sessionId, 17)).resolves.toMatchObject({ success: false })
  })
})

describe('embedded eDrawings resource and file validation', () => {
  it('resolves packaged native resources only from process.resourcesPath', () => {
    const packaged = {
      isPackaged: true,
      resourcesPath: 'C:\\app\\resources',
      cwd: 'C:\\workspace',
    }

    expect(getEDrawingsNativeModuleCandidates(packaged)).toEqual([
      'C:\\app\\resources\\bin\\edrawings_preview.node',
    ])
    expect(getEDrawingsPreviewHostCandidates(packaged)).toEqual([
      'C:\\app\\resources\\bin\\edrawings-preview-host\\BluePLM.EDrawingsPreviewHost.exe',
    ])
  })

  it('keeps development-only cwd fallbacks outside packaged resolution', () => {
    const candidates = getEDrawingsNativeModuleCandidates({
      isPackaged: false,
      resourcesPath: 'C:\\app\\resources',
      cwd: 'C:\\workspace',
    })
    expect(candidates).toContain('C:\\workspace\\native\\build\\Release\\edrawings_preview.node')
  })

  it('rejects manipulated renderer paths before the native host can read them', () => {
    const vaultRoot = path.resolve('vault')
    const inside = path.join(vaultRoot, 'parts', 'frame.sldprt')
    const neighbor = `${vaultRoot}-neighbor${path.sep}frame.sldprt`
    const symlink = path.join(vaultRoot, 'links', 'outside.sldprt')
    const dependencies = {
      realpath: (candidate: string) => candidate === symlink ? neighbor : candidate,
      isFile: (candidate: string) => candidate === inside || candidate === neighbor,
    }

    expect(validateEDrawingsPreviewFile(inside, vaultRoot, dependencies)).toMatchObject({
      success: true,
      filePath: inside,
    })
    expect(validateEDrawingsPreviewFile('\\\\server\\vault\\frame.sldprt', vaultRoot, dependencies))
      .toMatchObject({ success: false })
    expect(validateEDrawingsPreviewFile(`${vaultRoot}${path.sep}parts${path.sep}..${path.sep}frame.sldprt`, vaultRoot, dependencies))
      .toMatchObject({ success: false })
    expect(validateEDrawingsPreviewFile(neighbor, vaultRoot, dependencies)).toMatchObject({ success: false })
    expect(validateEDrawingsPreviewFile(symlink, vaultRoot, dependencies)).toMatchObject({ success: false })
    expect(validateEDrawingsPreviewFile(path.join(vaultRoot, 'notes.txt'), vaultRoot, dependencies))
      .toMatchObject({ success: false })
  })
})
