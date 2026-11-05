import { useState, useCallback } from 'react'
import { usePDMStore, DetailsPanelTab } from '@/stores/pdmStore'
import { useShallow } from 'zustand/react/shallow'
import { DraggableTab, TabDropZone, PanelLocation } from '@/components/shared/DraggableTab'
import { activeChildSelection } from '@/features/source/outputs/preview/childPreviewModel'
import { ItemBomPanel } from '@/features/items/itemBrowser/components/ItemBomPanel'
import { ExtensionRightPanelView } from '@/features/nativeExtensions/ExtensionViews'
import { ReviewPackagePane } from '@/features/source/reviewPackage'
import { selectReviewPackagePaneShown } from '@/stores/slices/reviewsSlice'
import { ArrowLeft } from 'lucide-react'
import { canPopOutTabs, isPopoutTab } from '../panelPopout/panelPopout'
import { PanelTabMenu, PoppedOutPlaceholder } from '../panelPopout/PanelTabMenu'
import { RightPanelTabContent } from './RightPanelTabContent'

export function RightPanel() {
  const {
    getSelectedFileObjects,
    rightPanelWidth,
    rightPanelTab,
    rightPanelTabs,
    setRightPanelTab,
    moveTabToBottom,
    moveTabToRight,
    reorderTabsInPanel,
    itemPanel,
    setItemPanel,
  } = usePDMStore(
    useShallow((s) => ({
      getSelectedFileObjects: s.getSelectedFileObjects,
      rightPanelWidth: s.rightPanelWidth,
      rightPanelTab: s.rightPanelTab,
      rightPanelTabs: s.rightPanelTabs,
      setRightPanelTab: s.setRightPanelTab,
      moveTabToBottom: s.moveTabToBottom,
      moveTabToRight: s.moveTabToRight,
      reorderTabsInPanel: s.reorderTabsInPanel,
      itemPanel: s.itemPanel,
      setItemPanel: s.setItemPanel,
    })),
  )
  const reviewPackagePaneShown = usePDMStore(selectReviewPackagePaneShown)
  const poppedOutTabs = usePDMStore((s) => s.poppedOutTabs)
  const [tabMenu, setTabMenu] = useState<{
    tab: DetailsPanelTab
    x: number
    y: number
  } | null>(null)
  const closeTabMenu = useCallback(() => setTabMenu(null), [])
  const canPopOut = canPopOutTabs()
  const extensionPanelWorkspace = usePDMStore((s) =>
    s.extensionRightPanel && s.extensionRightPanel === s.activeView
      ? (s.extensionWorkspaces.find((w) => w.id === s.extensionRightPanel && w.RightPanel) ?? null)
      : null,
  )

  // Handle tab drop from either panel
  const handleTabDrop = useCallback(
    (tabId: string, fromLocation: PanelLocation, toLocation: PanelLocation) => {
      if (fromLocation === toLocation) return // No change needed

      if (toLocation === 'bottom' && fromLocation === 'right') {
        // Moving from right panel to bottom
        moveTabToBottom(tabId as DetailsPanelTab)
      } else if (toLocation === 'right' && fromLocation === 'bottom') {
        // Moving from bottom panel to right
        moveTabToRight(tabId as DetailsPanelTab)
      }
    },
    [moveTabToBottom, moveTabToRight],
  )

  // Handle tab reorder within right panel
  const handleTabReorder = useCallback(
    (tabId: string, newIndex: number) => {
      reorderTabsInPanel('right', tabId as DetailsPanelTab, newIndex)
    },
    [reorderTabsInPanel],
  )

  const selectedFileObjects = getSelectedFileObjects()
  const file = selectedFileObjects.length === 1 ? selectedFileObjects[0] : null
  // An output or report row selected under the file: Preview shows it instead of the file.
  const childTarget = usePDMStore((s) => activeChildSelection(s.childSelection, s.selectedFiles))

  // The review pane, opened from a file or version context menu, wins over the view's own panel
  // until it is closed (the user asked for it explicitly), and fills the slot when the view has
  // nothing else to put there.
  if (reviewPackagePaneShown) {
    return (
      <div
        className="h-full bg-ui-bg border-l border-ui-border flex flex-col font-ui"
        style={{ width: rightPanelWidth }}
      >
        <ReviewPackagePane />
      </div>
    )
  }

  // A native extension workspace's own right panel, in its error boundary.
  if (extensionPanelWorkspace) {
    return (
      <div
        className="bg-plm-panel border-l border-plm-border flex flex-col"
        style={{ width: rightPanelWidth }}
      >
        <ExtensionRightPanelView workspace={extensionPanelWorkspace} />
      </div>
    )
  }

  // Item Browser detail panel (eBOM / mBOM) takes precedence over file-based tabs.
  if (itemPanel) {
    return (
      <div
        className="bg-plm-panel border-l border-plm-border flex flex-col"
        style={{ width: rightPanelWidth }}
      >
        <ItemBomPanel panel={itemPanel} onClose={() => setItemPanel(null)} />
      </div>
    )
  }

  if (rightPanelTabs.length === 0) return null

  return (
    <div
      className="bg-plm-panel border-l border-plm-border flex flex-col"
      style={{ width: rightPanelWidth }}
    >
      {/* Tabs - Droppable zone */}
      <TabDropZone
        location="right"
        onDrop={handleTabDrop}
        className="tabs flex-shrink-0 flex items-center justify-between pr-2 relative min-h-[32px]"
        tabCount={rightPanelTabs.length}
      >
        <div className="flex">
          {rightPanelTabs.map((tab, index) => (
            <div
              key={tab}
              className="flex"
              onContextMenu={
                canPopOut && isPopoutTab(tab)
                  ? (e) => {
                      e.preventDefault()
                      setTabMenu({ tab, x: e.clientX, y: e.clientY })
                    }
                  : undefined
              }
            >
              <DraggableTab
                id={tab}
                label={tab.charAt(0).toUpperCase() + tab.slice(1)}
                active={rightPanelTab === tab}
                location="right"
                index={index}
                onClick={() => setRightPanelTab(tab)}
                onDoubleClick={() => moveTabToBottom(tab)}
                onDragStart={() => {}}
                onDragEnd={() => {}}
                onReorder={handleTabReorder}
                tooltip="Drag to reorder or move to bottom panel"
              />
            </div>
          ))}
          {tabMenu && (
            <PanelTabMenu
              tab={tabMenu.tab}
              poppedOut={poppedOutTabs.includes(tabMenu.tab)}
              position={tabMenu}
              onClose={closeTabMenu}
            />
          )}
        </div>
        <button
          onClick={() => rightPanelTab && moveTabToBottom(rightPanelTab)}
          className="p-1 hover:bg-plm-bg-light rounded text-plm-fg-muted hover:text-plm-fg"
          title="Move tab to bottom panel"
        >
          <ArrowLeft size={14} />
        </button>
      </TabDropZone>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {rightPanelTab && poppedOutTabs.includes(rightPanelTab) ? (
          <PoppedOutPlaceholder tab={rightPanelTab} />
        ) : selectedFileObjects.length === 0 ? (
          <div className="text-sm text-plm-fg-muted text-center py-8">
            Select a file to view details
          </div>
        ) : selectedFileObjects.length > 1 ? (
          <div className="text-sm text-plm-fg-muted text-center py-8">
            {selectedFileObjects.length} files selected
          </div>
        ) : (
          file &&
          rightPanelTab && (
            <RightPanelTabContent tab={rightPanelTab} file={file} childTarget={childTarget} />
          )
        )}
      </div>
    </div>
  )
}
