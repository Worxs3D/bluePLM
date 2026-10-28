/**
 * ExtensionStoreView - Main view for browsing and managing extensions
 *
 * This is the primary UI for the in-app extension store.
 * Provides tabs for browsing the store and managing installed extensions.
 *
 * Installed packages are not run: the desktop has no extension runtime, and the
 * page says so. Install, sideload and uninstall are shown to administrators only
 * (getEffectiveRole() === 'admin', which includes the Administrators team).
 */
import { useEffect, useState } from 'react'
import { Store, Package, Upload, Info } from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'
import { useShallow } from 'zustand/react/shallow'
import { useExtensions } from '@/hooks/useExtensions'
import { log } from '@/lib/logger'
import { t } from '@/lib/i18n'

import { ExtensionList } from './ExtensionList'
import { ExtensionDetailsDialog } from './ExtensionDetailsDialog'
import { InstallDialog } from './InstallDialog'
import { SideloadDialog } from './SideloadDialog'
import { OrgExtensionsPanel } from '@/features/nativeExtensions/OrgExtensionsPanel'

type TabId = 'store' | 'installed'

export function ExtensionStoreView() {
  const [activeTab, setActiveTab] = useState<TabId>('store')
  const [selectedExtensionId, setSelectedExtensionId] = useState<string | null>(null)
  const [showInstallDialog, setShowInstallDialog] = useState(false)
  const [installExtensionId, setInstallExtensionId] = useState<string | null>(null)
  const [showSideloadDialog, setShowSideloadDialog] = useState(false)

  const { installedExtensions, storeExtensions, storeLoading } = useExtensions()
  const isAdmin = usePDMStore((s) => s.getEffectiveRole() === 'admin')

  const {
    fetchStoreExtensions,
    loadInstalledExtensions,
    uninstallExtension,
    addToast,
    pendingDeepLinkInstall,
    clearPendingDeepLinkInstall,
  } = usePDMStore(
    useShallow((s) => ({
      fetchStoreExtensions: s.fetchStoreExtensions,
      loadInstalledExtensions: s.loadInstalledExtensions,
      uninstallExtension: s.uninstallExtension,
      addToast: s.addToast,
      pendingDeepLinkInstall: s.pendingDeepLinkInstall,
      clearPendingDeepLinkInstall: s.clearPendingDeepLinkInstall,
    })),
  )

  // Load data on mount
  useEffect(() => {
    loadInstalledExtensions()
    fetchStoreExtensions()
  }, [])

  // Handle pending deep link install
  // When the user clicks "Install in BluePLM" from the website, this triggers
  useEffect(() => {
    if (pendingDeepLinkInstall && storeExtensions.length > 0) {
      const { extensionId } = pendingDeepLinkInstall
      log.info('[ExtensionStore]', 'Processing deep link install', { extensionId })

      // Check if extension exists in store
      const storeExt = storeExtensions.find((e) => e.extensionId === extensionId)
      if (!isAdmin) {
        log.warn('[ExtensionStore]', 'Deep link install refused: not an administrator', {
          extensionId,
        })
        addToast('warning', t('extensionRuntime.adminOnly'))
      } else if (storeExt) {
        // Open install dialog for this extension
        setInstallExtensionId(extensionId)
        setShowInstallDialog(true)
      } else {
        log.warn('[ExtensionStore]', 'Extension not found in store', { extensionId })
      }

      // Clear the pending install regardless (don't re-trigger)
      clearPendingDeepLinkInstall()
    }
  }, [pendingDeepLinkInstall, storeExtensions, clearPendingDeepLinkInstall, isAdmin, addToast])

  // Convert installed extensions record to array
  const installedArray = Object.values(installedExtensions)

  // Handle actions
  const handleViewDetails = (extensionId: string) => {
    setSelectedExtensionId(extensionId)
  }

  const handleInstall = (extensionId: string) => {
    setInstallExtensionId(extensionId)
    setShowInstallDialog(true)
  }

  const handleUninstall = async (extensionId: string) => {
    // Show confirmation in the future, for now just uninstall
    await uninstallExtension(extensionId)
  }

  const handleRefresh = () => {
    if (activeTab === 'store') {
      fetchStoreExtensions()
    } else {
      loadInstalledExtensions()
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Store size={24} className="text-blue-400" />
            <h1 className="text-xl font-semibold text-gray-100">Extension Store</h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Sideload button (administrators only) */}
            {isAdmin && (
              <button
                onClick={() => setShowSideloadDialog(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-700/50 text-gray-300 
                  rounded-lg hover:bg-gray-700 transition-colors"
              >
                <Upload size={16} />
                <span className="text-sm">Sideload</span>
              </button>
            )}
          </div>
        </div>

        {/* No runtime: say so rather than imply installed extensions run */}
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          <Info size={16} className="mt-0.5 shrink-0" />
          <div>
            <p>{t('extensionRuntime.notice')}</p>
            {!isAdmin && (
              <p className="mt-1 text-amber-400/80">{t('extensionRuntime.adminOnly')}</p>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          <button
            onClick={() => setActiveTab('store')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'store'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            <Store size={16} />
            <span>Browse Store</span>
            <span className="ml-1 px-1.5 py-0.5 bg-black/20 rounded text-xs">
              {storeExtensions.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('installed')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'installed'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            <Package size={16} />
            <span>Installed</span>
            <span className="ml-1 px-1.5 py-0.5 bg-black/20 rounded text-xs">
              {installedArray.length}
            </span>
          </button>
        </div>
      </div>

      {/* Organization-installed native extensions (these do run) */}
      <div className="px-6 pt-4">
        <OrgExtensionsPanel />
      </div>

      {/* Content */}
      <div className="flex-1 p-6 overflow-hidden">
        {activeTab === 'store' ? (
          <ExtensionList
            storeExtensions={storeExtensions}
            installedExtensions={installedArray}
            loading={storeLoading}
            emptyMessage="No extensions available in the store yet."
            onViewDetails={handleViewDetails}
            onInstall={isAdmin ? handleInstall : undefined}
            onUninstall={isAdmin ? handleUninstall : undefined}
            onRefresh={handleRefresh}
          />
        ) : (
          <ExtensionList
            installedExtensions={installedArray}
            loading={false}
            emptyMessage="No extensions installed. Browse the store to find extensions."
            showFilters={false}
            onViewDetails={handleViewDetails}
            onUninstall={isAdmin ? handleUninstall : undefined}
            onRefresh={handleRefresh}
          />
        )}
      </div>

      {/* Dialogs */}
      <ExtensionDetailsDialog
        extensionId={selectedExtensionId}
        open={!!selectedExtensionId}
        onClose={() => setSelectedExtensionId(null)}
        onInstall={
          isAdmin
            ? () => {
                if (selectedExtensionId) {
                  handleInstall(selectedExtensionId)
                }
              }
            : undefined
        }
        onUninstall={
          isAdmin
            ? () => {
                if (selectedExtensionId) {
                  handleUninstall(selectedExtensionId)
                  setSelectedExtensionId(null)
                }
              }
            : undefined
        }
      />

      <InstallDialog
        extensionId={installExtensionId}
        open={showInstallDialog}
        onClose={() => {
          setShowInstallDialog(false)
          setInstallExtensionId(null)
        }}
      />

      {isAdmin && (
        <SideloadDialog open={showSideloadDialog} onClose={() => setShowSideloadDialog(false)} />
      )}
    </div>
  )
}
