import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Loader2, MoreHorizontal } from 'lucide-react'

export interface ToolbarAction {
  id: string
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  /** Spinner instead of the icon. */
  loading?: boolean
  /** Toggle state: drawn pressed in the bar, with a check in the menu. */
  pressed?: boolean
  title?: string
  /** The view's main action: drawn as the primary button. */
  primary?: boolean
}

const GAP_PX = 4

function ActionButton({ action, measure }: { action: ToolbarAction; measure?: boolean }) {
  const tone = action.primary
    ? 'bg-ui-fg text-ui-bg border-transparent hover:bg-ui-fg/90'
    : action.pressed
      ? 'bg-ui-accent/15 text-ui-accent border-ui-accent/40 hover:bg-ui-accent/20'
      : 'bg-transparent text-ui-fg border-transparent hover:bg-ui-hover'
  return (
    <button
      type="button"
      tabIndex={measure ? -1 : undefined}
      onClick={measure ? undefined : action.onClick}
      disabled={action.disabled || action.loading}
      aria-pressed={action.pressed}
      title={action.title}
      className={`inline-flex h-7 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tone}`}
    >
      {action.loading ? <Loader2 size={13} className="animate-spin" /> : action.icon}
      {action.label}
    </button>
  )
}

/**
 * A row of icon + label actions that never wraps: the actions that fit are shown in order, the
 * rest go in a "More" menu. Widths are measured from an invisible copy of every button, so the
 * split follows the real labels in any language.
 */
export function ActionBar({
  actions,
  maxVisible = Infinity,
  moreLabel,
  className = '',
}: {
  actions: ToolbarAction[]
  /** Show at most this many in the bar even when more fit (the rest go in the menu). */
  maxVisible?: number
  /** Tooltip and accessible name of the More button. */
  moreLabel: string
  className?: string
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [shown, setShown] = useState(actions.length)
  const [menuOpen, setMenuOpen] = useState(false)
  const signature = actions.map((a) => `${a.id}:${a.label}:${a.loading ? 1 : 0}`).join('|')

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const measure = measureRef.current
    if (!wrap || !measure) return
    const compute = () => {
      const widths = Array.from(measure.children).map((c) => (c as HTMLElement).offsetWidth)
      const moreWidth = widths.pop() ?? 28
      const available = wrap.clientWidth
      let used = 0
      let fit = 0
      for (let i = 0; i < Math.min(widths.length, maxVisible); i++) {
        const next = used + (fit > 0 ? GAP_PX : 0) + widths[i]
        const reserve = i < widths.length - 1 || widths.length > maxVisible ? GAP_PX + moreWidth : 0
        if (next + reserve > available) break
        used = next
        fit += 1
      }
      setShown(fit)
    }
    compute()
    const observer = new ResizeObserver(compute)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [signature, maxVisible])

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof MouseEvent && wrapRef.current?.contains(event.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [menuOpen])

  const visible = actions.slice(0, shown)
  const overflow = actions.slice(shown)

  return (
    <div
      ref={wrapRef}
      className={`relative flex min-w-0 flex-1 items-center justify-end gap-1 ${className}`}
    >
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute right-0 top-0 flex gap-1 overflow-hidden"
      >
        {actions.map((a) => (
          <ActionButton key={a.id} action={a} measure />
        ))}
        <span className="inline-flex h-7 w-7" />
      </div>
      {visible.map((a) => (
        <ActionButton key={a.id} action={a} />
      ))}
      {overflow.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={moreLabel}
            aria-label={moreLabel}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ui-fg-secondary hover:bg-ui-hover hover:text-ui-fg"
          >
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-1 min-w-52 rounded-lg border border-plm-border bg-plm-bg-light py-1 shadow-xl"
            >
              {overflow.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="menuitem"
                  disabled={a.disabled || a.loading}
                  title={a.title}
                  onClick={() => {
                    setMenuOpen(false)
                    a.onClick()
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ui-fg hover:bg-ui-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="flex w-4 justify-center text-ui-fg-secondary">
                    {a.loading ? <Loader2 size={13} className="animate-spin" /> : a.icon}
                  </span>
                  <span className="flex-1">{a.label}</span>
                  {a.pressed && <Check size={13} className="text-ui-accent" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
