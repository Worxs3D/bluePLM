import { useId } from 'react'
import { X } from 'lucide-react'

import { IconButton } from '@/components/core/ui'
import { t } from '@/lib/i18n'

import type { DialogProps } from './types'

/**
 * A modal in the app's `ui-*` style: neutral surface, hairline edge, 12px radius, 16px semibold
 * title. Width defaults to 448px; pass `className` (e.g. `max-w-lg`) to widen it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className = '',
}: DialogProps) {
  const titleId = useId()
  if (!open) return null

  return (
    <div
      data-native-preview-overlay="modal"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ui-scrim" onClick={onClose} />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`relative mx-4 w-full max-w-md rounded-xl border border-ui-border bg-ui-bg text-ui-fg shadow-2xl ${className}`}
      >
        {title && (
          <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[16px] font-semibold leading-6 text-ui-fg">
                {title}
              </h2>
              {description && (
                <p className="mt-1 text-[14px] leading-[1.4] text-ui-fg-secondary">{description}</p>
              )}
            </div>
            <IconButton
              label={t('common.close')}
              icon={<X size={16} />}
              onClick={onClose}
              className="-mr-1.5"
            />
          </div>
        )}
        <div className="px-5 pb-4 pt-3 text-[14px] leading-[1.45]">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 pb-4">{footer}</div>}
      </div>
    </div>
  )
}
