import type { HTMLAttributes, ReactNode } from 'react'

export type RowDensity = 'default' | 'compact'

export interface RowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  /** The row's name. In settings, keep it equal to the settings search catalog's label. */
  label: ReactNode
  description?: ReactNode
  /** The control: a Switch, Select, Button, SegmentedControl and the like. */
  children?: ReactNode
  /** The id of the control, so clicking the label focuses it. */
  htmlFor?: string
  /** Shown after the label: a Badge such as "Admin" or "Beta". */
  badge?: ReactNode
  /** Put the control under the text at full width (lists, text areas, narrow panes). */
  stacked?: boolean
  /** Dim the text when the row does not apply right now. The control disables itself. */
  disabled?: boolean
  /** `default`: 16px vertical padding (settings). `compact`: 10px and 13px descriptions, for panes. */
  density?: RowDensity
}

/**
 * A name and a sentence about it on the left, its control on the right. Rows go inside a RowGroup,
 * which draws the hairlines between them. Flush with the section heading, like Claude's settings.
 */
export function Row({
  label,
  description,
  children,
  htmlFor,
  badge,
  stacked = false,
  disabled = false,
  density = 'default',
  className = '',
  ...rest
}: RowProps) {
  const LabelTag = htmlFor ? 'label' : 'div'
  const compact = density === 'compact'
  return (
    <div
      {...rest}
      className={`flex ${compact ? 'gap-x-6 gap-y-2 py-2.5' : 'gap-x-12 gap-y-3 py-4'} ${
        stacked ? 'flex-col' : 'items-center justify-between'
      } ${disabled ? 'opacity-50' : ''} ${className}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <LabelTag htmlFor={htmlFor} className="text-[14px] leading-5 text-ui-fg">
            {label}
          </LabelTag>
          {badge}
        </div>
        {description && (
          <div
            className={`mt-1 leading-[1.4] text-ui-fg-secondary ${compact ? 'text-[13px]' : 'text-[14px]'}`}
          >
            {description}
          </div>
        )}
      </div>
      {children && (
        <div className={stacked ? 'w-full min-w-0' : 'flex flex-shrink-0 items-center gap-2'}>
          {children}
        </div>
      )}
    </div>
  )
}
