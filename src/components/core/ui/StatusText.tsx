import type { ReactNode } from 'react'
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent'

const TONE: Record<StatusTone, { text: string; Icon: LucideIcon }> = {
  success: { text: 'text-ui-success', Icon: CircleCheck },
  warning: { text: 'text-ui-warning', Icon: TriangleAlert },
  danger: { text: 'text-ui-danger', Icon: CircleAlert },
  neutral: { text: 'text-ui-fg-secondary', Icon: CircleDashed },
  accent: { text: 'text-ui-accent', Icon: CircleDot },
}

interface StatusTextProps {
  tone?: StatusTone
  children: ReactNode
  /** Replace the tone's glyph; `false` for text only. */
  icon?: ReactNode | false
  title?: string
  className?: string
}

/**
 * A state in words, coloured by tone, with a 12px glyph so it never relies on colour alone.
 * Replaces tinted status chips; a tinted Badge is kept only for states that need one (overdue).
 */
export function StatusText({
  tone = 'neutral',
  children,
  icon,
  title,
  className = '',
}: StatusTextProps) {
  const { text, Icon } = TONE[tone]
  return (
    <span
      title={title}
      className={`inline-flex min-w-0 items-start gap-1.5 text-[13px] leading-[1.35] ${text} ${className}`}
    >
      {icon === false ? null : (
        <span className="mt-[2px] flex flex-shrink-0" aria-hidden>
          {icon ?? <Icon size={12} />}
        </span>
      )}
      <span className="min-w-0">{children}</span>
    </span>
  )
}
