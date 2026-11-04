import type { KeyboardEvent, ReactNode } from 'react'

export interface ListRowCheckbox {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Accessible name ("Select Bracket set"). */
  label: string
  /** Always shown; otherwise it appears on hover and focus only (default true). */
  visible?: boolean
}

export interface ListRowProps {
  title: ReactNode
  /** The second line: 13px secondary text, or a StatusText. */
  secondary?: ReactNode
  /** An icon or avatar left of the text, top-aligned with the title. */
  leading?: ReactNode
  /** Right of the title line: a due date, a count, a Badge. */
  trailing?: ReactNode
  /** Further lines under the secondary one (warnings). */
  children?: ReactNode
  /**
   * IconButtons right of the row, outside the activating element (so they never nest inside it).
   * Shown on hover and focus unless `actionsVisible`.
   */
  actions?: ReactNode
  actionsVisible?: boolean
  selected?: boolean
  disabled?: boolean
  /** Click, Enter and Space. Without it the row is static text. */
  onActivate?: () => void
  /**
   * `button` (default): the row is a button. `option`: the row is a `role="option"` inside a
   * `role="listbox"` parent, which owns arrow-key movement; `tabIndex` comes from the parent.
   */
  role?: 'button' | 'option'
  /** A selection checkbox, outside the activating element. */
  checkbox?: ListRowCheckbox
  /** `hairline` (default): square, for RowGroup lists. `rounded`: 8px radius, for spaced lists. */
  shape?: 'hairline' | 'rounded'
  /** Tooltip of the activating element. */
  hint?: string
  id?: string
  tabIndex?: number
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
  className?: string
}

/**
 * A selectable two-line row: title, secondary line, optional leading icon, trailing text,
 * checkbox and row actions. 14px title, 13px secondary, hover and selected fills from `ui-*`.
 */
export function ListRow({
  title,
  secondary,
  leading,
  trailing,
  children,
  actions,
  actionsVisible = false,
  selected = false,
  disabled = false,
  onActivate,
  role = 'button',
  checkbox,
  shape = 'hairline',
  hint,
  id,
  tabIndex,
  onKeyDown,
  className = '',
}: ListRowProps) {
  const interactive = !!onActivate && !disabled
  const body = (
    <>
      {leading && (
        <span className="mt-0.5 flex flex-shrink-0 text-ui-fg-secondary" aria-hidden>
          {leading}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ui-fg">{title}</span>
          {trailing && (
            <span className="flex flex-shrink-0 items-center text-[13px] text-ui-fg-secondary">
              {trailing}
            </span>
          )}
        </span>
        {secondary && (
          <span className="mt-0.5 min-w-0 text-[13px] leading-[1.35] text-ui-fg-secondary">
            {secondary}
          </span>
        )}
        {children && <span className="mt-1 flex min-w-0 flex-col gap-0.5">{children}</span>}
      </span>
    </>
  )

  const activatorClass = `flex min-w-0 flex-1 items-start gap-3 text-left outline-none ${
    interactive ? 'cursor-pointer' : ''
  }`

  let activator: ReactNode
  if (!onActivate) {
    activator = (
      <div className={activatorClass} title={hint}>
        {body}
      </div>
    )
  } else if (role === 'option') {
    activator = (
      <div
        id={id}
        role="option"
        aria-selected={selected}
        aria-disabled={disabled || undefined}
        tabIndex={tabIndex ?? -1}
        title={hint}
        className={activatorClass}
        onClick={interactive ? onActivate : undefined}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (e.defaultPrevented || !interactive) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onActivate()
          }
        }}
      >
        {body}
      </div>
    )
  } else {
    activator = (
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-pressed={selected || undefined}
        tabIndex={tabIndex}
        title={hint}
        onClick={onActivate}
        onKeyDown={onKeyDown}
        className={`${activatorClass} disabled:cursor-not-allowed`}
      >
        {body}
      </button>
    )
  }

  return (
    <div
      className={`group relative flex items-start gap-2 px-3 py-2.5 transition-colors duration-100 focus-within:bg-ui-hover ${
        shape === 'rounded' ? 'rounded-lg' : ''
      } ${selected ? 'bg-ui-selected' : interactive ? 'hover:bg-ui-hover' : ''} ${
        disabled ? 'opacity-50' : ''
      } ${className}`}
    >
      {checkbox && (
        <input
          type="checkbox"
          checked={checkbox.checked}
          aria-label={checkbox.label}
          onChange={(e) => checkbox.onChange(e.target.checked)}
          className={`mt-[3px] h-3.5 w-3.5 flex-shrink-0 accent-ui-accent ${
            checkbox.visible === false && !checkbox.checked
              ? 'opacity-0 focus:opacity-100 group-hover:opacity-100'
              : ''
          }`}
        />
      )}
      {activator}
      {actions && (
        <span
          className={`flex flex-shrink-0 items-center gap-0.5 ${
            actionsVisible ? '' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'
          }`}
        >
          {actions}
        </span>
      )}
    </div>
  )
}
