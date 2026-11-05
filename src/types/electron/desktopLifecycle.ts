export interface DesktopLifecycleAPI {
  // App info
  getVersion: () => Promise<string>
  getPlatform: () => Promise<string>
  getTitleBarOverlayRect: () => Promise<{ x: number; y: number; width: number; height: number }>
  setTitleBarOverlay: (options: {
    color: string
    symbolColor: string
    /** 'settings': the settings window's controls instead of the calling window's. */
    target?: 'settings'
  }) => Promise<{ success: boolean; error?: string }>
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<{ success: boolean; factor?: number; error?: string }>
  onZoomChanged: (callback: (factor: number) => void) => () => void
  getWindowSize: () => Promise<{ width: number; height: number } | null>
  setWindowSize: (width: number, height: number) => Promise<{ success: boolean; error?: string }>
  resetWindowSize: () => Promise<{
    success: boolean
    size?: { width: number; height: number }
    error?: string
  }>
  getPathForFile: (file: File) => string
  reloadApp: () => Promise<{ success: boolean; error?: string }>
  requestFocus: () => Promise<{ success: boolean; error?: string }>
  openPerformanceWindow: () => Promise<{ success: boolean; error?: string }>
  /** Pop a tab out into its own window (TabWindow); one window per `key`, asking again focuses it. */
  openTabWindow: (request: {
    key: string
    view: string
    title: string
    customData?: Record<string, unknown>
    width?: number
    height?: number
  }) => Promise<{ success: boolean; error?: string }>

  // Window controls
  close: () => void

  /**
   * The quit handshake for review decisions still in their undo window: the window says whether it
   * holds any, and the main process asks it to send them before the app quits
   * (`installReviewDecisionQuitBridge` in src/lib/reviewDecisionFlush.ts).
   */
  reviewDecisions: {
    setPending: (pending: boolean) => void
    onFlushRequest: (callback: (requestId: string) => void) => () => void
    flushDone: (requestId: string) => void
  }
}
