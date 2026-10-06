export interface PreviewSessionLifecycle {
  readonly disposed: boolean
  readonly sessionId: string | undefined
  registerSession(sessionId: string): void
  isActive(sessionId: string): boolean
  dispose(): void
}

export type EDrawingsPreviewApi = Pick<
  NonNullable<Window['electronAPI']>,
  | 'createEDrawingsPreview'
  | 'attachEDrawingsPreview'
  | 'loadEDrawingsFile'
  | 'setEDrawingsBounds'
  | 'showEDrawingsPreview'
  | 'hideEDrawingsPreview'
  | 'destroyEDrawingsPreview'
>

type EDrawingsPreviewCreateResult = Awaited<ReturnType<EDrawingsPreviewApi['createEDrawingsPreview']>>
type EDrawingsPreviewOperationResult = Awaited<
  ReturnType<EDrawingsPreviewApi['attachEDrawingsPreview']>
>
type EDrawingsPreviewLoadResult = Awaited<ReturnType<EDrawingsPreviewApi['loadEDrawingsFile']>>

export interface PreviewSessionController {
  readonly disposed: boolean
  readonly sessionId: string | undefined
  create(): Promise<EDrawingsPreviewCreateResult | undefined>
  attach(): Promise<EDrawingsPreviewOperationResult | undefined>
  load(filePath: string): Promise<EDrawingsPreviewLoadResult | undefined>
  setBounds(x: number, y: number, width: number, height: number): Promise<EDrawingsPreviewOperationResult | undefined>
  show(): Promise<EDrawingsPreviewOperationResult | undefined>
  hide(): Promise<EDrawingsPreviewOperationResult | undefined>
  destroy(): Promise<void>
  isActive(sessionId: string): boolean
  dispose(): void
}

/** Keeps a native-preview session tied to one React effect lifetime. */
export function createPreviewSessionLifecycle(): PreviewSessionLifecycle {
  let disposed = false
  let sessionId: string | undefined

  return {
    get disposed() {
      return disposed
    },
    get sessionId() {
      return sessionId
    },
    registerSession(value) {
      sessionId = value
    },
    isActive(value) {
      return !disposed && sessionId === value
    },
    dispose() {
      disposed = true
    },
  }
}

/** Token-binds every native IPC operation to one renderer effect lifetime. */
export function createPreviewSessionController(api: EDrawingsPreviewApi): PreviewSessionController {
  const lifecycle = createPreviewSessionLifecycle()
  let destroyed = false

  const run = async <T>(operation: (sessionId: string) => Promise<T>): Promise<T | undefined> => {
    const sessionId = lifecycle.sessionId
    if (!sessionId || !lifecycle.isActive(sessionId)) return undefined
    const result = await operation(sessionId)
    return lifecycle.isActive(sessionId) ? result : undefined
  }

  return {
    get disposed() {
      return lifecycle.disposed
    },
    get sessionId() {
      return lifecycle.sessionId
    },
    async create() {
      if (lifecycle.disposed) return undefined
      const result = await api.createEDrawingsPreview()
      if (result.success) lifecycle.registerSession(result.sessionId)
      return result
    },
    attach() {
      return run((sessionId) => api.attachEDrawingsPreview(sessionId))
    },
    load(filePath) {
      return run((sessionId) => api.loadEDrawingsFile(sessionId, filePath))
    },
    setBounds(x, y, width, height) {
      return run((sessionId) => api.setEDrawingsBounds(sessionId, x, y, width, height))
    },
    show() {
      return run((sessionId) => api.showEDrawingsPreview(sessionId))
    },
    hide() {
      return run((sessionId) => api.hideEDrawingsPreview(sessionId))
    },
    async destroy() {
      const sessionId = lifecycle.sessionId
      if (!sessionId || destroyed) return
      destroyed = true
      await api.destroyEDrawingsPreview(sessionId)
      if (!lifecycle.isActive(sessionId)) return
    },
    isActive(sessionId) {
      return lifecycle.isActive(sessionId)
    },
    dispose() {
      lifecycle.dispose()
    },
  }
}
