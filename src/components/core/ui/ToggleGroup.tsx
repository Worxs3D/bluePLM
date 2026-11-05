import type { ReactNode } from 'react'

export interface ToggleOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
  title?: string
}

interface ToggleGroupProps<T extends string> {
  /** The options that are on. */
  value: readonly T[]
  options: readonly ToggleOption<T>[]
  /** The new set, in the options' order. */
  onChange: (value: T[]) => void
  size?: 'sm' | 'md'
  disabled?: boolean
  'aria-label'?: string
}

/**
 * A small set of independent on/off choices shown side by side (several may be on), with the look
 * of SegmentedControl: "which outputs does a line start with". Each option is a toggle button
 * (`aria-pressed`), so the state never rests on colour alone for assistive technology.
 */
export function ToggleGroup<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  disabled = false,
  'aria-label': ariaLabel,
}: ToggleGroupProps<T>) {
  const toggle = (option: T) => {
    const on = value.includes(option) ? value.filter((v) => v !== option) : [...value, option]
    onChange(options.map((o) => o.value).filter((v) => on.includes(v)))
  }
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex flex-shrink-0 flex-wrap items-center gap-0.5 rounded-lg border border-ui-divider bg-ui-field p-0.5"
    >
      {options.map((option) => {
        const pressed = value.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            disabled={disabled || option.disabled}
            title={option.title}
            onClick={() => toggle(option.value)}
            className={`inline-flex items-center whitespace-nowrap rounded-md border transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/50 disabled:cursor-not-allowed disabled:opacity-40 ${
              size === 'sm' ? 'h-6 px-2.5 text-[13px]' : 'h-7 px-3.5 text-[14px]'
            } ${
              pressed
                ? 'border-ui-selected-border bg-ui-selected text-ui-fg'
                : 'border-transparent text-ui-fg-tertiary hover:bg-ui-hover hover:text-ui-fg-secondary'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
