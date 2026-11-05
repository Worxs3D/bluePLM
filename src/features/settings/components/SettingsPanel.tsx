import { SquareArrowOutDownLeft, SquareArrowOutUpRight, X } from 'lucide-react'

import { BluePlmLogo } from '@/components/shared/BluePlmLogo'
import { usePDMStore } from '@/stores/pdmStore'
import { useTranslation } from '@/lib/i18n'

import { SettingsContent } from './SettingsContent'
import { SettingsNavigation } from './SettingsNavigation'
import { SETTINGS_TITLE_BAR_HEIGHT } from './settingsWindowLayout'

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)

/** Room the system's window controls take at the right of the window's title bar (Windows, Linux). */
const WINDOW_CONTROLS_WIDTH = 144

const ICON_BUTTON =
  'rounded-lg p-1.5 text-ui-fg-secondary outline-none transition-colors hover:bg-ui-hover hover:text-ui-fg focus-visible:ring-2 focus-visible:ring-ui-accent/50'

/**
 * Settings itself: navigation and search on the left, the page on the right, under a header.
 * As a modal (`variant="dialog"`) the header holds the title, the pop-out button (desktop) and
 * close. In its own window (`variant="window"`) the header is the window's title bar: the
 * BluePLM mark and title, draggable, with the button that puts Settings back in the main window;
 * the system draws minimise, maximise and close at its right (`electron/settingsWindow.ts`).
 * Styled after Claude's settings (`.cursor/plans/settings-claude-aesthetic.md`).
 */
export function SettingsPanel(
  props: { variant: 'dialog'; onPopOut?: () => void } | { variant: 'window'; onDockBack: () => void },
) {
  const { t } = useTranslation()
  const activeTab = usePDMStore((s) => s.settingsTab)
  const setSettingsTab = usePDMStore((s) => s.setSettingsTab)
  const closeSettings = usePDMStore((s) => s.closeSettings)

  return (
    <>
      {props.variant === 'dialog' ? (
        <header className="flex h-[46px] flex-shrink-0 select-none items-center justify-between border-b border-ui-border pl-[18px] pr-2">
          <h2 id="settings-modal-title" className="text-[16px] font-semibold text-ui-fg">
            {t('settings.title')}
          </h2>
          <div className="flex items-center gap-0.5">
            {props.onPopOut && (
              <button
                type="button"
                onClick={props.onPopOut}
                title={t('settings.popOut')}
                aria-label={t('settings.popOut')}
                className={ICON_BUTTON}
              >
                <SquareArrowOutUpRight size={17} strokeWidth={1.75} />
              </button>
            )}
            <button
              type="button"
              onClick={closeSettings}
              title={t('settings.close')}
              aria-label={t('settings.close')}
              className={ICON_BUTTON}
            >
              <X size={20} strokeWidth={1.75} />
            </button>
          </div>
        </header>
      ) : (
        <header
          style={{
            height: SETTINGS_TITLE_BAR_HEIGHT,
            paddingLeft: IS_MAC ? 80 : 12,
            paddingRight: IS_MAC ? 12 : WINDOW_CONTROLS_WIDTH,
          }}
          className="titlebar-drag-region flex flex-shrink-0 select-none items-center justify-between gap-3 border-b border-ui-border bg-ui-nav"
        >
          <div className="flex min-w-0 items-center gap-2">
            <BluePlmLogo className="flex-shrink-0 text-ui-accent" />
            <h2 id="settings-modal-title" className="truncate text-[13px] font-semibold text-ui-fg">
              {t('settings.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={props.onDockBack}
            title={t('settings.dockBack')}
            aria-label={t('settings.dockBack')}
            className={`titlebar-no-drag ${ICON_BUTTON}`}
          >
            <SquareArrowOutDownLeft size={16} strokeWidth={1.75} />
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
