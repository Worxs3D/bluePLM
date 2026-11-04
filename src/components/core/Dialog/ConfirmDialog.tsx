import { useCallback, useEffect, useId } from 'react'

import { Button } from '@/components/core/ui'
import { useHostWindow } from '@/hooks/useHostWindow'
import { t } from '@/lib/i18n'

import { enterConfirms } from './confirmKeys'
import { Dialog } from './Dialog'
import type { ConfirmDialogProps } from './types'

/**
 * Ask before an action. Focus moves into the dialog (to the confirm button, unless a field in it
 * took focus first). Enter confirms, except in a text area or on one of the dialog's own buttons,
 * which handle Enter themselves (`enterConfirms`); Escape cancels.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  message,
  children,
  confirmText,
  cancelText,
  onConfirm,
  variant = 'info',
  confirmDisabled = false,
  className,
}: ConfirmDialogProps) {
  const host = useHostWindow()

  const confirm = useCallback(() => {
    if (confirmDisabled) return
    onConfirm()
    onClose()
  }, [confirmDisabled, onConfirm, onClose])

  const confirmId = useId()
  const confirmButton = useCallback(
    () => host.document.querySelector<HTMLButtonElement>(`[data-confirm-id="${confirmId}"]`),
    [host, confirmId],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const dialog = confirmButton()?.closest('[role="dialog"]') ?? null
      if (e.key === 'Enter' && enterConfirms(e.target as Element | null, dialog)) {
        e.preventDefault()
        confirm()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [confirm, onClose, confirmButton],
  )

  // Focus into the dialog, so Enter and Tab act here and not on what opened it.
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      const button = confirmButton()
      const dialog = button?.closest('[role="dialog"]')
      const active = host.document.activeElement
      if (button && dialog && !(active && dialog.contains(active))) button.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [open, confirmButton, host])

  useEffect(() => {
    if (!open) return
    host.document.addEventListener('keydown', handleKeyDown)
    return () => host.document.removeEventListener('keydown', handleKeyDown)
  }, [open, handleKeyDown, host])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      className={className}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {cancelText ?? t('common.cancel')}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            disabled={confirmDisabled}
            onClick={confirm}
            data-confirm-id={confirmId}
          >
            {confirmText ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="text-ui-fg-secondary">{message}</div>
      {children && <div className="mt-3">{children}</div>}
    </Dialog>
  )
}
