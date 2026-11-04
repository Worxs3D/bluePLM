import { useCallback, useEffect } from 'react'

import { Button } from '@/components/core/ui'
import { useHostWindow } from '@/hooks/useHostWindow'
import { t } from '@/lib/i18n'

import { Dialog } from './Dialog'
import type { ConfirmDialogProps } from './types'

/**
 * Ask before an action. Enter confirms (except inside a text area or on a focused button, which
 * handle Enter themselves) and Escape cancels.
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

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'BUTTON') {
        e.preventDefault()
        confirm()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [confirm, onClose],
  )

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
