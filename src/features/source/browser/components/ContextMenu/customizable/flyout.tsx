/**
 * Which flyout is open, one per menu level.
 *
 * Every row that opens a flyout (a group, an export format, Keep Local Only, Change State, the
 * assembly submenus) asks `useFlyout(key)` instead of keeping its own open flag, so the rows of
 * one level can never show two flyouts at once: opening a sibling closes the other at once, and
 * leaving a row closes its flyout after a short delay (time to reach the flyout). A flyout's
 * contents sit inside a new `FlyoutProvider`, so they are a level of their own, and since that
 * provider unmounts with the flyout, reopening a parent starts with its children closed.
 *
 * Outside a provider (a row used on its own) `useFlyout` keeps the open flag locally, as the rows
 * did before.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/** How long a flyout stays open after the pointer leaves its row or itself. */
export const FLYOUT_CLOSE_DELAY_MS = 150

interface FlyoutLevel {
  openKey: string | null
  open: (key: string) => void
  close: (key: string) => void
  scheduleClose: (key: string) => void
  toggle: (key: string) => void
}

const FlyoutContext = createContext<FlyoutLevel | null>(null)

/** One menu level: at most one of its flyouts is open. */
export function FlyoutProvider({ children }: { children: ReactNode }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  // The pending close, and whose it is: closing one flyout must not cancel another's.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timerKey = useRef<string | null>(null)

  const cancelTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
      timerKey.current = null
    }
  }, [])

  useEffect(() => cancelTimer, [cancelTimer])

  const value = useMemo<FlyoutLevel>(
    () => ({
      openKey,
      open: (key) => {
        cancelTimer()
        setOpenKey(key)
      },
      close: (key) => {
        if (timerKey.current === key) cancelTimer()
        setOpenKey((current) => (current === key ? null : current))
      },
      scheduleClose: (key) => {
        cancelTimer()
        timerKey.current = key
        timer.current = setTimeout(() => {
          timer.current = null
          timerKey.current = null
          setOpenKey((current) => (current === key ? null : current))
        }, FLYOUT_CLOSE_DELAY_MS)
      },
      toggle: (key) => {
        cancelTimer()
        setOpenKey((current) => (current === key ? null : key))
      },
    }),
    [openKey, cancelTimer],
  )

  return <FlyoutContext.Provider value={value}>{children}</FlyoutContext.Provider>
}

export interface Flyout {
  isOpen: boolean
  /** For the row and the flyout: keep it open, and close any sibling. */
  onMouseEnter: () => void
  /** For the row and the flyout: close after `FLYOUT_CLOSE_DELAY_MS`. */
  onMouseLeave: () => void
  toggle: () => void
  /** Open or close at once (the shape of the old `setShowXSubmenu` props). */
  setOpen: (open: boolean) => void
}

/** The open state of the flyout `key` at this menu level. */
export function useFlyout(key: string): Flyout {
  const level = useContext(FlyoutContext)
  const [localOpen, setLocalOpen] = useState(false)
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (localTimer.current) clearTimeout(localTimer.current)
    },
    [],
  )

  if (level) {
    return {
      isOpen: level.openKey === key,
      onMouseEnter: () => level.open(key),
      onMouseLeave: () => level.scheduleClose(key),
      toggle: () => level.toggle(key),
      setOpen: (open) => (open ? level.open(key) : level.close(key)),
    }
  }

  const clearLocal = () => {
    if (localTimer.current) {
      clearTimeout(localTimer.current)
      localTimer.current = null
    }
  }
  return {
    isOpen: localOpen,
    onMouseEnter: () => {
      clearLocal()
      setLocalOpen(true)
    },
    onMouseLeave: () => {
      clearLocal()
      localTimer.current = setTimeout(() => setLocalOpen(false), FLYOUT_CLOSE_DELAY_MS)
    },
    toggle: () => {
      clearLocal()
      setLocalOpen((open) => !open)
    },
    setOpen: (open) => {
      clearLocal()
      setLocalOpen(open)
    },
  }
}
