import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { usePDMStore, type SidebarView } from '@/stores/pdmStore'
import {
  ExtensionNavigatorView,
  ExtensionNotLoaded,
  ExtensionWorkspaceView,
  useExtensionWorkspace,
} from '@/features/nativeExtensions/ExtensionViews'
import { CORE_VIEW_IDS } from '@/lib/nativeExtensions/registry'
import { popoutTabOf } from '../panelPopout/panelPopout'
import { BluePlmLogo } from '@/components/shared/BluePlmLogo'
import { titleBarOverlayColors } from '@/lib/titleBarOverlay'

// Lazy loaded views
const FileTree = lazy(() =>
  import('@/features/source/explorer').then((m) => ({ default: m.FileTree })),
)
const PendingView = lazy(() =>
  import('@/features/source/pending').then((m) => ({ default: m.PendingView })),
)
const WorkflowsView = lazy(() =>
  import('@/features/source/workflows/WorkflowsView').then((m) => ({ default: m.WorkflowsView })),
)
const HistoryView = lazy(() =>
  import('@/features/source/history').then((m) => ({ default: m.HistoryView })),
)
const TrashView = lazy(() =>
  import('@/features/source/trash').then((m) => ({ default: m.TrashView })),
)
const TerminalView = lazy(() =>
  import('@/features/dev-tools/terminal').then((m) => ({ default: m.TerminalView })),
)
const ECOView = lazy(() =>
  import('@/features/change-control/eco').then((m) => ({ default: m.ECOView })),
)
const DeviationsView = lazy(() =>
  import('@/features/change-control/deviations').then((m) => ({ default: m.DeviationsView })),
)
const ItemBrowserView = lazy(() =>
  import('@/features/items/itemBrowser').then((m) => ({ default: m.ItemBrowserView })),
)
const SuppliersView = lazy(() =>
  import('@/features/supply-chain/suppliers').then((m) => ({ default: m.SuppliersView })),
)
const SupplierPortalView = lazy(() =>
  import('@/features/supply-chain/portal').then((m) => ({ default: m.SupplierPortalView })),
)
const OrdersPane = lazy(() =>
  import('@/features/orders').then((m) => ({ default: m.OrdersPane })),
)
const OrderDetailView = lazy(() =>
  import('@/features/orders').then((m) => ({ default: m.OrderDetailView })),
)
const SettingsContent = lazy(() =>
  import('@/features/settings').then((m) => ({ default: m.SettingsContent })),
)
const FilePane = lazy(() =>
  import('@/features/source/browser').then((m) => ({ default: m.FilePane })),
)
const GoogleDrivePanel = lazy(() =>
  import('@/features/integrations/google-drive').then((m) => ({ default: m.GoogleDrivePanel })),
)
const PanelPopoutWindow = lazy(() =>
  import('../panelPopout/PanelPopoutWindow').then((m) => ({ default: m.PanelPopoutWindow })),
)

// Loading fallback
function ViewLoading() {
  return (
    <div className="flex items-center justify-center h-full text-plm-fg-muted">
      <Loader2 size={24} className="animate-spin" />
    </div>
  )
}

interface TabWindowProps {
  view: SidebarView
  title: string
  customData?: Record<string, unknown>
}

export function TabWindow({ view, title, customData }: TabWindowProps) {
  const theme = usePDMStore((s) => s.theme)
  const extensionWorkspace = useExtensionWorkspace(view)

  // Apply theme, to the page and to the window controls Electron draws over the header
  useEffect(() => {
    let effectiveTheme = theme
    if (theme === 'system') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    document.documentElement.setAttribute('data-theme', effectiveTheme)
    window.electronAPI?.setTitleBarOverlay?.(titleBarOverlayColors(effectiveTheme))
  }, [theme])

  // Room for those controls: top right on Windows and Linux, traffic lights top left on macOS.
  const [controls, setControls] = useState({ left: 12, right: 140 })
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    let cancelled = false
    void Promise.all([api.getPlatform(), api.getTitleBarOverlayRect?.()]).then(
      ([platform, rect]) => {
        if (cancelled) return
        if (platform === 'darwin') setControls({ left: 80, right: 12 })
        else if (rect?.width) setControls({ left: 12, right: rect.width + 8 })
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  // Render the appropriate view based on the view type
  const panel = popoutTabOf(customData)
  const renderView = useMemo(() => {
    // A popped-out details tab: driven by the main window, not by a view (panelPopout/).
    if (panel) {
      return (
        <Suspense fallback={<ViewLoading />}>
          <PanelPopoutWindow tab={panel} />
        </Suspense>
      )
    }
    // Native extension workspace (only when its extension is loaded in this window)
    if (extensionWorkspace) {
      return (
        <div className="flex-1 flex overflow-hidden">
          {extensionWorkspace.Navigator && (
            <div className="w-64 border-r border-plm-border overflow-hidden flex flex-col">
              <ExtensionNavigatorView workspace={extensionWorkspace} />
            </div>
          )}
          <ExtensionWorkspaceView workspace={extensionWorkspace} />
        </div>
      )
    }
    if (!CORE_VIEW_IDS.has(view)) return <ExtensionNotLoaded />

    // Views that have both sidebar and main content
    const mainContentViews: SidebarView[] = ['explorer', 'google-drive', 'settings', 'orders']

    if (mainContentViews.includes(view)) {
      switch (view) {
        case 'explorer':
          return (
            <div className="flex-1 flex overflow-hidden">
              <div className="w-64 border-r border-plm-border overflow-auto">
                <Suspense fallback={<ViewLoading />}>
                  <FileTree
                    onOpenVault={() => {}}
                    onOpenRecentVault={() => {}}
                    onRefresh={() => {}}
                  />
                </Suspense>
              </div>
              <div className="flex-1 overflow-hidden">
                <Suspense fallback={<ViewLoading />}>
                  <FilePane onRefresh={() => {}} />
                </Suspense>
              </div>
            </div>
          )
        case 'orders':
          return (
            <div className="flex-1 flex overflow-hidden">
              <div className="w-72 border-r border-ui-border overflow-auto bg-ui-nav">
                <Suspense fallback={<ViewLoading />}>
                  <OrdersPane />
                </Suspense>
              </div>
              <div className="flex-1 flex overflow-hidden">
                <Suspense fallback={<ViewLoading />}>
                  <OrderDetailView />
                </Suspense>
              </div>
            </div>
          )
        case 'google-drive':
          return (
            <div className="flex-1 overflow-hidden">
              <Suspense fallback={<ViewLoading />}>
                <GoogleDrivePanel />
              </Suspense>
            </div>
          )
        case 'settings':
          return (
            <div className="flex-1 overflow-hidden">
              <Suspense fallback={<ViewLoading />}>
                <SettingsContent activeTab="profile" />
              </Suspense>
            </div>
          )
        default:
          return null
      }
    }

    // Sidebar-only views (render full width)
    switch (view) {
      case 'pending':
        return (
          <Suspense fallback={<ViewLoading />}>
            <PendingView onRefresh={() => {}} />
          </Suspense>
        )
      case 'workflows':
        return (
          <Suspense fallback={<ViewLoading />}>
            <WorkflowsView />
          </Suspense>
        )
      case 'history':
        return (
          <Suspense fallback={<ViewLoading />}>
            <HistoryView />
          </Suspense>
        )
      case 'trash':
        return (
          <Suspense fallback={<ViewLoading />}>
            <TrashView />
          </Suspense>
        )
      case 'terminal':
        return (
          <Suspense fallback={<ViewLoading />}>
            <TerminalView onRefresh={() => {}} />
          </Suspense>
        )
      case 'eco':
        return (
          <Suspense fallback={<ViewLoading />}>
            <ECOView />
          </Suspense>
        )
      case 'deviations':
        return (
          <Suspense fallback={<ViewLoading />}>
            <DeviationsView />
          </Suspense>
        )
      case 'items':
        return (
          <Suspense fallback={<ViewLoading />}>
            <ItemBrowserView />
          </Suspense>
        )
      case 'supplier-database':
        return (
          <Suspense fallback={<ViewLoading />}>
            <SuppliersView />
          </Suspense>
        )
      case 'supplier-portal':
        return (
          <Suspense fallback={<ViewLoading />}>
            <SupplierPortalView />
          </Suspense>
        )
      default:
        return (
          <div className="flex items-center justify-center h-full text-plm-fg-muted">
            Unknown view: {view}
          </div>
        )
    }
  }, [view, extensionWorkspace, panel])

  return (
    <div className="h-screen flex flex-col bg-plm-bg overflow-hidden">
      {/* Title bar (drag to move); Electron draws the window controls over it */}
      <div
        className="h-9 flex-shrink-0 bg-plm-activitybar border-b border-plm-border flex items-center gap-2 select-none titlebar-drag-region"
        style={{ paddingLeft: controls.left, paddingRight: controls.right }}
      >
        <BluePlmLogo className="text-plm-accent flex-shrink-0" />
        <span className="text-sm font-medium text-plm-fg truncate">{title}</span>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">{renderView}</div>
    </div>
  )
}

// Helper to parse tab window params from URL
export function parseTabWindowParams(): {
  view: SidebarView
  title: string
  customData?: Record<string, unknown>
} | null {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')

  if (mode !== 'tab') return null

  const view = params.get('view') as SidebarView
  const title = params.get('title') || 'BluePLM'
  const customDataParam = params.get('customData')

  let customData: Record<string, unknown> | undefined
  if (customDataParam) {
    try {
      customData = JSON.parse(atob(decodeURIComponent(customDataParam)))
    } catch {
      // Ignore parse errors
    }
  }

  return { view, title, customData }
}

// Check if we're in tab window mode
export function isTabWindowMode(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.get('mode') === 'tab'
}
