export interface PreviewSessionLifecycle {
  readonly disposed: boolean
  readonly sessionId: string | undefined
  registerSession(sessionId: string): void
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
