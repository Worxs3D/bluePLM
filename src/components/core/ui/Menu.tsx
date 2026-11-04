import type { ReactNode } from 'react'
import { Check, Loader2 } from 'lucide-react'

/** The floating panel of a small menu (ActionBar's More, OverflowMenu). Position it with `className`. */
export function MenuPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="menu"
      className={`absolute z-30 min-w-52 rounded-lg border border-ui-border bg-ui-bg py-1 shadow-xl ${className}`}
    >
      {children}
    </div>
  )
}

export interface MenuItemProps {
  label: string
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
  loading?: boolean
  /** Destructive: red text. */
  danger?: boolean
  /** Toggle state: a check on the right. */
  checked?: boolean
  title?: string
}

/** One entry of a MenuPanel. */
export function MenuItem({
  label,
  icon,
  onSelect,
  disabled,
  loading,
  danger,
  checked,
  title,
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled || loading}
      title={title}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-ui-hover focus-visible:bg-ui-hover focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? 'text-ui-danger' : 'text-ui-fg'
      }`}
    >
      {(icon || loading) && (
        <span className={`flex w-4 justify-center ${danger ? '' : 'text-ui-fg-secondary'}`}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : icon}
        </span>
      )}
      <span className="flex-1">{label}</span>
      {checked && <Check size={13} className="text-ui-accent" />}
    </button>
  )
}
