import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type IconButtonSize = 'sm' | 'md'

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'title'> {
  /** Required: becomes the accessible name and the tooltip. */
  label: string
  /** A lucide icon, 15-16px. */
  icon: ReactNode
  /** `md` 28px square (default), `sm` 24px (inside rows). */
  size?: IconButtonSize
  /** Destructive: red on hover. */
  danger?: boolean
  /** Toggle state, drawn pressed. */
  pressed?: boolean
}

const SIZE: Record<IconButtonSize, string> = { sm: 'h-6 w-6 rounded-md', md: 'h-7 w-7 rounded-lg' }

/** A square ghost button with only an icon. Its label is never optional. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = 'md', danger = false, pressed, className = '', type = 'button', ...rest },
  ref,
) {
  const tone = pressed
    ? 'bg-ui-selected text-ui-fg'
    : danger
      ? 'text-ui-fg-secondary hover:bg-ui-danger/10 hover:text-ui-danger'
      : 'text-ui-fg-secondary hover:bg-ui-hover hover:text-ui-fg'
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      {...rest}
      className={`inline-flex flex-shrink-0 items-center justify-center transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/50 disabled:cursor-not-allowed disabled:opacity-40 ${SIZE[size]} ${tone} ${className}`}
    >
      {icon}
    </button>
  )
})
