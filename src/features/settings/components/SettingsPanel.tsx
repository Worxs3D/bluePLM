import type { PointerEvent as ReactPointerEvent } from 'react'
import { X } from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'
import { useTranslation } from '@/lib/i18n'

import { SettingsContent } from './SettingsContent'
import { SettingsNavigation } from './SettingsNavigation'

/**
 * Settings itself: navigation and search on the left, the page on the right. Shown in its own
 * window on the desktop (`SettingsWindow`, whose title bar is the system's) and as a floating
 * panel elsewhere (`SettingsFloating`, which passes `onHeaderPointerDown` to drag it by the
 * header). Styled after Claude's settings (`.cursor/plans/settings-claude-aesthetic.md`).
 */
export function SettingsPanel({
  showHeader,
  onHeaderPointerDown,
}: {
  showHeader: boolean
  onHeaderPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void
}) {
  const { t } = useTranslation()
  const activeTab = usePDMStore((s) => s.settingsTab)
  const setSettingsTab = usePDMStore((s) => s.setSettingsTab)
  const closeSettings = usePDMStore((s) => s.closeSettings)

  return (
    <>
      {showHeader && (
        <header
          onPointerDown={onHeaderPointerDown}
          className="flex h-[46px] flex-shrink-0 cursor-move select-none items-center justify-between border-b border-ui-border pl-[18px] pr-2"
        >
          <h2 id="settings-modal-title" className="text-[16px] font-semibold text-ui-fg">
            {t('settings.title')}
          </h2>
          <button
            type="button"
            onClick={closeSettings}
            onPointerDown={(e) => e.stopPropagation()}
            title={t('settings.close')}
            aria-label={t('settings.close')}
            className="cursor-default rounded-lg p-1.5 text-ui-fg outline-none transition-colors hover:bg-ui-hover focus-visible:ring-2 focus-visible:ring-ui-accent/50"
          >
            <X size={20} strokeWidth={1.75} />
          </button>
        </header>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="w-[256px] flex-shrink-0 border-r border-ui-border bg-ui-nav">
          <SettingsNavigation activeTab={activeTab} onTabChange={setSettingsTab} />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <SettingsContent activeTab={activeTab} />
        </main>
      </div>
    </>
  )
}
