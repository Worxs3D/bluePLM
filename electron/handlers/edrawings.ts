import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { app, BrowserWindow, ipcMain, shell, type WebContents } from 'electron'

export interface EDrawingsDiscoveryDependencies {
  exists: (candidate: string) => boolean
  listDirectories: (parent: string) => string[]
}

export interface EDrawingsHandlerDependencies {
  getWorkingDirectory: () => string | null
  logWarn: (message: string, data?: unknown) => void
}

export interface EDrawingsPreviewPathDependencies {
  isPackaged: boolean
  resourcesPath: string
  cwd: string
}

export interface EDrawingsPreviewFileDependencies {
  realpath: (candidate: string) => string
  isFile: (candidate: string) => boolean
}

export interface NativeEDrawingsPreview {
  attachToWindow(handle: Buffer): boolean | Promise<boolean>
  loadFile(filePath: string, previewHostPath: string): boolean | Promise<boolean>
  setBounds(x: number, y: number, width: number, height: number): boolean | Promise<boolean>
  show(): boolean | Promise<boolean>
  hide(): boolean | Promise<boolean>
  destroy(): boolean | Promise<boolean>
  lastError(): string
}

interface NativeEDrawingsModule {
  EDrawingsPreview: new () => NativeEDrawingsPreview
}

interface PreviewWebContents {
  id: number
  isDestroyed(): boolean
  on(event: string, listener: () => void): unknown
  removeListener(event: string, listener: () => void): unknown
}

export interface PreviewOwner {
  webContents: PreviewWebContents
  getNativeWindowHandle(): Buffer
  isDestroyed(): boolean
  isMinimized(): boolean
  isVisible(): boolean
  on(event: string, listener: () => void): unknown
  removeListener(event: string, listener: () => void): unknown
}

export interface PreviewBounds {
  x: number
  y: number
  width: number
  height: number
}

interface PreviewSession {
  id: string
  owner: PreviewOwner
  ownerWebContentsId: number
  preview: NativeEDrawingsPreview
  bounds: PreviewBounds
  disposeLifecycle: () => void
}

interface PreviewResult {
  success: boolean
  error?: string
}

interface PreviewCreateResult extends PreviewResult {
  sessionId?: string
}

interface PreviewLoadResult extends PreviewResult {
  /**
   * `accepted` means the native bridge accepted the launch request. It is not a
   * visual-ready signal: the preview host has no completion callback yet.
   */
  accepted?: boolean
  ready?: false
}

interface EDrawingsPreviewControllerDependencies {
  createPreview: () => NativeEDrawingsPreview | null
  getPreviewHostPath: () => string | null
  validateFile: (filePath: unknown) => PreviewResult & { filePath?: string }
  logWarn: (message: string, data?: unknown) => void
  createSessionId?: () => string
}

export interface EDrawingsPreviewController {
  create(owner: PreviewOwner, senderId: number): PreviewCreateResult
  attach(sessionId: unknown, senderId: number): Promise<PreviewResult>
  load(sessionId: unknown, senderId: number, filePath: unknown): Promise<PreviewLoadResult>
  setBounds(
    sessionId: unknown,
    senderId: number,
    bounds: PreviewBounds,
  ): Promise<PreviewResult>
  show(sessionId: unknown, senderId: number): Promise<PreviewResult>
  hide(sessionId: unknown, senderId: number): Promise<PreviewResult>
  destroy(sessionId: unknown, senderId: number): Promise<PreviewResult>
  cleanup(): void
}

const PROGRAM_FILES = ['C:\\Program Files', 'C:\\Program Files (x86)']
const EXECUTABLE_NAMES = ['eDrawings.exe', 'EModelViewer.exe']
const CAD_FILE_EXTENSIONS = new Set([
  '.sldprt',
  '.sldasm',
  '.slddrw',
  '.eprt',
  '.easm',
  '.edrw',
])
const EMPTY_BOUNDS: PreviewBounds = { x: 0, y: 0, width: 1, height: 1 }

let nativeEDrawingsModule: NativeEDrawingsModule | null | undefined
let previewController: EDrawingsPreviewController | null = null
const loadNativeModule = createRequire(__filename)

function candidatesIn(directory: string): string[] {
  return EXECUTABLE_NAMES.map((name) => path.win32.join(directory, name))
}

/**
 * Resolve the external eDrawings viewer without assuming a single installer
 * layout. Recent releases install below Common Files/eDrawingsYYYY, whereas
 * older releases used one of the SOLIDWORKS Corp paths.
 */
export function findEDrawingsExecutable(
  dependencies: EDrawingsDiscoveryDependencies = {
    exists: fs.existsSync,
    listDirectories: (parent) => {
      try {
        return fs.readdirSync(parent, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      } catch {
        return []
      }
    },
  },
): string | null {
  const directories = [
    ...PROGRAM_FILES.flatMap((programFiles) => [
      path.win32.join(programFiles, 'SOLIDWORKS Corp', 'eDrawings'),
      path.win32.join(programFiles, 'eDrawings'),
      path.win32.join(programFiles, 'SOLIDWORKS Corp', 'SOLIDWORKS', 'eDrawings'),
    ]),
  ]

  for (const programFiles of PROGRAM_FILES) {
    const commonFiles = path.win32.join(programFiles, 'Common Files')
    for (const entry of dependencies.listDirectories(commonFiles)) {
      if (/^edrawings(?:\d{4})?$/i.test(entry)) {
        directories.push(path.win32.join(commonFiles, entry))
      }
    }
  }

  for (const candidate of directories.flatMap(candidatesIn)) {
    if (dependencies.exists(candidate)) return candidate
  }

  return null
}

export function getEDrawingsNativeModuleCandidates(
  dependencies: Pick<
    EDrawingsPreviewPathDependencies,
    'isPackaged' | 'resourcesPath' | 'cwd'
  >,
): string[] {
  const packagedCandidate = path.join(
    dependencies.resourcesPath,
    'bin',
    'edrawings_preview.node',
  )
  if (dependencies.isPackaged) return [packagedCandidate]

  return [
    packagedCandidate,
    path.join(dependencies.cwd, 'resources', 'bin', 'win32', 'edrawings_preview.node'),
    path.join(dependencies.cwd, 'native', 'build', 'Release', 'edrawings_preview.node'),
  ]
}

export function getEDrawingsPreviewHostCandidates(
  dependencies: Pick<
    EDrawingsPreviewPathDependencies,
    'isPackaged' | 'resourcesPath' | 'cwd'
  >,
): string[] {
  const executableName = 'BluePLM.EDrawingsPreviewHost.exe'
  const packagedCandidate = path.join(
    dependencies.resourcesPath,
    'bin',
    'edrawings-preview-host',
    executableName,
  )
  if (dependencies.isPackaged) return [packagedCandidate]

  return [
    packagedCandidate,
    path.join(
      dependencies.cwd,
      'resources',
      'bin',
      'win32',
      'edrawings-preview-host',
      executableName,
    ),
    path.join(dependencies.cwd, 'edrawings-preview-host', 'publish', 'win-x64', executableName),
  ]
}

export function validateEDrawingsPreviewFile(
  filePath: unknown,
  vaultRoot: string | null,
  dependencies: EDrawingsPreviewFileDependencies = {
    realpath: fs.realpathSync,
    isFile: (candidate) => {
      try {
        return fs.statSync(candidate).isFile()
      } catch {
        return false
      }
    },
  },
): PreviewResult & { filePath?: string } {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.includes('\0')) {
    return { success: false, error: 'The preview file path is invalid' }
  }
  if (!vaultRoot) return { success: false, error: 'No active vault directory is available' }
  if (isUncPath(filePath) || hasTraversalSegment(filePath) || !path.isAbsolute(filePath)) {
    return { success: false, error: 'The preview file path is not allowed' }
  }
  if (!CAD_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return { success: false, error: 'The preview file type is not supported' }
  }

  try {
    const realVaultRoot = dependencies.realpath(vaultRoot)
    const realFilePath = dependencies.realpath(filePath)
    if (isUncPath(realVaultRoot) || isUncPath(realFilePath) || !dependencies.isFile(realFilePath)) {
      return { success: false, error: 'The preview file is not available locally' }
    }

    const relativePath = path.relative(realVaultRoot, realFilePath)
    if (
      relativePath === '' ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      return { success: false, error: 'The preview file is outside the active vault' }
    }

    return { success: true, filePath: realFilePath }
  } catch {
    return { success: false, error: 'The preview file is not available locally' }
  }
}

/**
 * Owns the optional native preview object in the main process. Renderer calls
 * hold only a capability token tied to the creator's webContents, so delayed
 * IPC from an unmounted panel cannot alter a later panel's native child window.
 */
export function createEDrawingsPreviewController(
  dependencies: EDrawingsPreviewControllerDependencies,
): EDrawingsPreviewController {
  let session: PreviewSession | null = null

  const isCurrentSession = (candidate: PreviewSession): boolean => session?.id === candidate.id

  const getSession = (sessionId: unknown, senderId: number): PreviewSession | null => {
    if (
      typeof sessionId !== 'string' ||
      !session ||
      session.id !== sessionId ||
      session.ownerWebContentsId !== senderId ||
      session.owner.isDestroyed() ||
      session.owner.webContents.isDestroyed()
    ) {
      return null
    }
    return session
  }

  const destroyCurrentSession = (): void => {
    const current = session
    if (!current) return
    session = null
    current.disposeLifecycle()
    try {
      void Promise.resolve(current.preview.destroy())
        .then((destroyed) => {
          if (!destroyed) {
            dependencies.logWarn('[eDrawings] Embedded preview reported an unsuccessful destroy')
          }
        })
        .catch((error: unknown) => {
          dependencies.logWarn('[eDrawings] Failed to destroy embedded preview', {
            error: String(error),
          })
        })
    } catch (error) {
      dependencies.logWarn('[eDrawings] Failed to destroy embedded preview', {
        error: String(error),
      })
    }
  }

  const syncOwnerPreview = (owner: PreviewOwner, showAfterSync = false): void => {
    const current = session
    if (!current || current.owner !== owner) return
    if (owner.isMinimized() || !owner.isVisible()) {
      try {
        void current.preview.hide()
      } catch (error) {
        dependencies.logWarn('[eDrawings] Failed to hide embedded preview', { error: String(error) })
      }
      return
    }

    const { x, y, width, height } = current.bounds
    Promise.resolve(current.preview.setBounds(x, y, width, height))
      .then((bounded) => {
        if (!bounded || !showAfterSync || !isCurrentSession(current)) return undefined
        return current.preview.show()
      })
      .catch((error: unknown) => {
        dependencies.logWarn('[eDrawings] Failed to synchronize embedded preview bounds', {
          error: String(error),
        })
      })
  }

  const stale = (): PreviewResult => ({
    success: false,
    error: 'The preview session is no longer active',
  })

  const invoke = async (
    sessionId: unknown,
    senderId: number,
    action: (current: PreviewSession) => boolean | Promise<boolean>,
  ): Promise<PreviewResult> => {
    const current = getSession(sessionId, senderId)
    if (!current) return stale()
    try {
      const succeeded = await action(current)
      if (!isCurrentSession(current)) return stale()
      return succeeded
        ? { success: true }
        : { success: false, error: current.preview.lastError() || 'The preview operation failed' }
    } catch (error) {
      if (!isCurrentSession(current)) return stale()
      return { success: false, error: String(error) }
    }
  }

  return {
    create(owner, senderId) {
      if (
        owner.isDestroyed() ||
        owner.webContents.isDestroyed() ||
        owner.webContents.id !== senderId
      ) {
        return { success: false, error: 'The preview request did not come from the application window' }
      }

      let preview: NativeEDrawingsPreview | null
      try {
        preview = dependencies.createPreview()
      } catch (error) {
        dependencies.logWarn('[eDrawings] Failed to create embedded preview', {
          error: String(error),
        })
        return { success: false, error: 'Optional Windows preview module is unavailable' }
      }
      if (!preview) return { success: false, error: 'Optional Windows preview module is unavailable' }

      destroyCurrentSession()
      const sessionId = (dependencies.createSessionId ?? randomUUID)()
      const cleanup = () => {
        if (session?.id === sessionId) destroyCurrentSession()
      }
      const hideForOwner = () => syncOwnerPreview(owner)
      const restoreForOwner = () => syncOwnerPreview(owner, true)
      const syncBoundsForOwner = () => syncOwnerPreview(owner)
      const disposeLifecycle = () => {
        owner.webContents.removeListener('render-process-gone', cleanup)
        owner.webContents.removeListener('did-start-navigation', cleanup)
        owner.removeListener('closed', cleanup)
        owner.removeListener('minimize', hideForOwner)
        owner.removeListener('hide', hideForOwner)
        owner.removeListener('restore', restoreForOwner)
        owner.removeListener('show', restoreForOwner)
        owner.removeListener('move', syncBoundsForOwner)
        owner.removeListener('resize', syncBoundsForOwner)
        owner.removeListener('maximize', syncBoundsForOwner)
        owner.removeListener('unmaximize', syncBoundsForOwner)
      }
      session = {
        id: sessionId,
        owner,
        ownerWebContentsId: senderId,
        preview,
        bounds: { ...EMPTY_BOUNDS },
        disposeLifecycle,
      }
      owner.webContents.on('render-process-gone', cleanup)
      owner.webContents.on('did-start-navigation', cleanup)
      owner.on('closed', cleanup)
      owner.on('minimize', hideForOwner)
      owner.on('hide', hideForOwner)
      owner.on('restore', restoreForOwner)
      owner.on('show', restoreForOwner)
      owner.on('move', syncBoundsForOwner)
      owner.on('resize', syncBoundsForOwner)
      owner.on('maximize', syncBoundsForOwner)
      owner.on('unmaximize', syncBoundsForOwner)
      return { success: true, sessionId }
    },

    attach(sessionId, senderId) {
      return invoke(sessionId, senderId, (current) =>
        current.preview.attachToWindow(current.owner.getNativeWindowHandle()),
      )
    },

    async load(sessionId, senderId, filePath) {
      const current = getSession(sessionId, senderId)
      if (!current) return stale()
      const checkedFile = dependencies.validateFile(filePath)
      if (!checkedFile.success || !checkedFile.filePath) return checkedFile
      const previewHostPath = dependencies.getPreviewHostPath()
      if (!previewHostPath) {
        return { success: false, error: 'The eDrawings preview host is unavailable' }
      }
      try {
        const accepted = await current.preview.loadFile(checkedFile.filePath, previewHostPath)
        if (!isCurrentSession(current)) return stale()
        return accepted
          ? { success: true, accepted: true, ready: false }
          : { success: false, error: current.preview.lastError() || 'eDrawings could not host this file' }
      } catch (error) {
        if (!isCurrentSession(current)) return stale()
        return { success: false, error: String(error) }
      }
    },

    setBounds(sessionId, senderId, bounds) {
      if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
        return Promise.resolve({ success: false, error: 'The preview bounds are invalid' })
      }
      return invoke(sessionId, senderId, (current) => {
        current.bounds = {
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.max(1, Math.round(bounds.width)),
          height: Math.max(1, Math.round(bounds.height)),
        }
        return current.preview.setBounds(
          current.bounds.x,
          current.bounds.y,
          current.bounds.width,
          current.bounds.height,
        )
      })
    },

    show(sessionId, senderId) {
      return invoke(sessionId, senderId, async (current) => {
        if (current.owner.isMinimized() || !current.owner.isVisible()) {
          return current.preview.hide()
        }
        const { x, y, width, height } = current.bounds
        const bounded = await current.preview.setBounds(x, y, width, height)
        return bounded && current.preview.show()
      })
    },

    hide(sessionId, senderId) {
      return invoke(sessionId, senderId, (current) => current.preview.hide())
    },

    async destroy(sessionId, senderId) {
      const current = getSession(sessionId, senderId)
      if (!current) return stale()
      destroyCurrentSession()
      return { success: true }
    },

    cleanup: destroyCurrentSession,
  }
}

export function registerEDrawingsHandlers(
  window: BrowserWindow,
  dependencies: EDrawingsHandlerDependencies,
): void {
  const getNativeModule = (): NativeEDrawingsModule | null => {
    if (nativeEDrawingsModule !== undefined) return nativeEDrawingsModule
    if (process.platform !== 'win32') {
      nativeEDrawingsModule = null
      return null
    }

    for (const candidate of getEDrawingsNativeModuleCandidates({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      cwd: process.cwd(),
    })) {
      if (!fs.existsSync(candidate)) continue
      try {
        const loaded = loadNativeModule(candidate) as NativeEDrawingsModule
        if (typeof loaded.EDrawingsPreview === 'function') {
          nativeEDrawingsModule = loaded
          return loaded
        }
      } catch (error) {
        dependencies.logWarn('[eDrawings] Optional embedded preview module could not be loaded', {
          candidate,
          error: String(error),
        })
      }
    }

    nativeEDrawingsModule = null
    return null
  }

  const getPreviewHostPath = (): string | null => {
    const candidates = getEDrawingsPreviewHostCandidates({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      cwd: process.cwd(),
    })
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
  }

  previewController = createEDrawingsPreviewController({
    createPreview: () => {
      const nativeModule = getNativeModule()
      return nativeModule ? new nativeModule.EDrawingsPreview() : null
    },
    getPreviewHostPath,
    validateFile: (filePath) =>
      validateEDrawingsPreviewFile(filePath, dependencies.getWorkingDirectory()),
    logWarn: dependencies.logWarn,
  })

  const isApplicationWindowSender = (sender: WebContents): boolean =>
    !window.isDestroyed() && sender.id === window.webContents.id

  ipcMain.handle('edrawings:check-installed', async () => {
    const eDrawingsPath = findEDrawingsExecutable()
    return { installed: eDrawingsPath !== null, path: eDrawingsPath }
  })

  ipcMain.handle('edrawings:native-available', () =>
    Boolean(findEDrawingsExecutable() && getPreviewHostPath() && getNativeModule()),
  )

  ipcMain.handle('edrawings:open-file', async (_, filePath: string) => {
    const eDrawingsPath = findEDrawingsExecutable()
    if (!eDrawingsPath) {
      try {
        await shell.openPath(filePath)
        return { success: true, fallback: true }
      } catch {
        return { success: false, error: 'eDrawings not found' }
      }
    }

    try {
      spawn(eDrawingsPath, [filePath], { detached: true, stdio: 'ignore' }).unref()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('edrawings:get-window-handle', (event) => {
    if (!isApplicationWindowSender(event.sender)) return null
    return Array.from(window.getNativeWindowHandle())
  })

  ipcMain.handle('edrawings:create-preview', (event) =>
    previewController?.create(window, event.sender.id) ?? {
      success: false,
      error: 'The preview service is unavailable',
    },
  )
  ipcMain.handle('edrawings:attach-preview', (event, sessionId: unknown) =>
    previewController?.attach(sessionId, event.sender.id) ?? {
      success: false,
      error: 'The preview service is unavailable',
    },
  )
  ipcMain.handle('edrawings:load-file', (event, sessionId: unknown, filePath: unknown) =>
    previewController?.load(sessionId, event.sender.id, filePath) ?? {
      success: false,
      error: 'The preview service is unavailable',
    },
  )
  ipcMain.handle(
    'edrawings:set-bounds',
    (event, sessionId: unknown, x: unknown, y: unknown, width: unknown, height: unknown) => {
      if (![x, y, width, height].every((value) => typeof value === 'number')) {
        return { success: false, error: 'The preview bounds are invalid' }
      }
      return previewController?.setBounds(sessionId, event.sender.id, {
        x: x as number,
        y: y as number,
        width: width as number,
        height: height as number,
      }) ?? {
        success: false,
        error: 'The preview service is unavailable',
      }
    },
  )
  ipcMain.handle('edrawings:show-preview', (event, sessionId: unknown) =>
    previewController?.show(sessionId, event.sender.id) ?? {
      success: false,
      error: 'The preview service is unavailable',
    },
  )
  ipcMain.handle('edrawings:hide-preview', (event, sessionId: unknown) =>
    previewController?.hide(sessionId, event.sender.id) ?? {
      success: false,
      error: 'The preview service is unavailable',
    },
  )
  ipcMain.handle('edrawings:destroy-preview', (event, sessionId: unknown) =>
    previewController?.destroy(sessionId, event.sender.id) ?? {
      success: false,
      error: 'The preview service is unavailable',
    },
  )
}

export function unregisterEDrawingsHandlers(): void {
  previewController?.cleanup()
  previewController = null
  for (const channel of [
    'edrawings:check-installed',
    'edrawings:native-available',
    'edrawings:open-file',
    'edrawings:get-window-handle',
    'edrawings:create-preview',
    'edrawings:attach-preview',
    'edrawings:load-file',
    'edrawings:set-bounds',
    'edrawings:show-preview',
    'edrawings:hide-preview',
    'edrawings:destroy-preview',
  ]) {
    ipcMain.removeHandler(channel)
  }
}

function hasTraversalSegment(candidate: string): boolean {
  return candidate.split(/[\\/]+/).some((segment) => segment === '..')
}

function isUncPath(candidate: string): boolean {
  return candidate.startsWith('\\\\') || candidate.startsWith('//')
}
