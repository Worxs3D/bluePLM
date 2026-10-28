/**
 * Renders native extension workspaces in the app layout. Every extension
 * component is wrapped in its own error boundary: an extension that throws shows
 * a message in its own area and the rest of the app keeps working.
 */
import { Component, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Puzzle } from 'lucide-react'
import { usePDMStore } from '@/stores/pdmStore'
import { log } from '@/lib/logger'
import { t } from '@/lib/i18n'
import type { ExtensionWorkspace } from '@/types/nativeExtensions'

interface BoundaryProps {
  extensionId: string
  /** Which part failed, for the log. */
  slot: string
  children: ReactNode
}

interface BoundaryState {
  error: Error | null
}

export class ExtensionBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error(`[Ext:${this.props.extensionId}]`, `${this.props.slot} crashed`, {
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center bg-plm-bg">
        <AlertTriangle size={24} className="text-plm-warning" />
        <p className="text-sm font-medium text-plm-fg">{t('nativeExtensions.crashedTitle')}</p>
        <p className="text-xs text-plm-fg-muted max-w-sm break-words">
          {t('nativeExtensions.crashedBody', { id: this.props.extensionId })}
        </p>
        <p className="text-xs text-plm-fg-dim max-w-sm break-words font-mono">
          {this.state.error.message}
        </p>
        <button
          className="btn btn-ghost btn-sm mt-2"
          onClick={() => this.setState({ error: null })}
        >
          {t('nativeExtensions.retry')}
        </button>
      </div>
    )
  }
}

/** The registered workspace for a view id, if any. */
export function useExtensionWorkspace(view: string | null | undefined): ExtensionWorkspace | null {
  return usePDMStore((s) =>
    view ? (s.extensionWorkspaces.find((w) => w.id === view) ?? null) : null,
  )
}

function Slot({
  workspace,
  slot,
  component: Rendered,
}: {
  workspace: ExtensionWorkspace
  slot: string
  component: ComponentType
}) {
  return (
    <ExtensionBoundary key={`${workspace.extensionId}:${workspace.id}`} extensionId={workspace.extensionId} slot={slot}>
      <Rendered />
    </ExtensionBoundary>
  )
}

/** Main area of an extension workspace. */
export function ExtensionWorkspaceView({ workspace }: { workspace: ExtensionWorkspace }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      <Slot workspace={workspace} slot="Workspace" component={workspace.Workspace} />
    </div>
  )
}

/** Sidebar of an extension workspace (its Navigator, or nothing to show). */
export function ExtensionNavigatorView({ workspace }: { workspace: ExtensionWorkspace }) {
  if (!workspace.Navigator) {
    return (
      <div className="p-4 text-xs text-plm-fg-muted flex items-center gap-2">
        <Puzzle size={14} />
        {workspace.title}
      </div>
    )
  }
  return <Slot workspace={workspace} slot="Navigator" component={workspace.Navigator} />
}

/** Right panel of an extension workspace. */
export function ExtensionRightPanelView({ workspace }: { workspace: ExtensionWorkspace }) {
  if (!workspace.RightPanel) return null
  return <Slot workspace={workspace} slot="RightPanel" component={workspace.RightPanel} />
}

/** Shown when a view id belongs to no core module and no loaded extension. */
export function ExtensionNotLoaded() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center bg-plm-bg">
      <Puzzle size={24} className="text-plm-fg-muted" />
      <p className="text-sm text-plm-fg-muted">{t('nativeExtensions.notLoaded')}</p>
    </div>
  )
}
