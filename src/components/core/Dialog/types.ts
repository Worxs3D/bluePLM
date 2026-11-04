import type { ReactNode } from 'react'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  /** A sentence under the title, in secondary grey. */
  description?: ReactNode
  children: ReactNode
  /** Buttons, right-aligned under the body (Cancel, then the primary). */
  footer?: ReactNode
  className?: string
}

export interface ConfirmDialogProps extends Omit<DialogProps, 'children' | 'footer'> {
  message: ReactNode
  /** More content under the message: a list of files, a comment field. */
  children?: ReactNode
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  /** `danger` draws the confirm button red; `warning` and `info` use the primary button. */
  variant?: 'danger' | 'warning' | 'info'
  /** Disable the confirm button (with the reason in the body). */
  confirmDisabled?: boolean
}
