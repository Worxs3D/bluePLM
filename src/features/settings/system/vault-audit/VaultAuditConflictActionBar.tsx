import { AlertTriangle, Check, FileUp } from 'lucide-react'

import { Button } from '@/components/core/ui'
import { t } from '@/lib/i18n'

import type { UseVaultAuditConflictResult } from './useVaultAuditConflict'
import type { UseVaultAuditPushResult } from './useVaultAuditPush'
import { FooterMessage, VaultAuditFooter } from './VaultAuditFooter'
import { countOf } from './vaultAuditLabels'

interface VaultAuditConflictActionBarProps {
  conflict: UseVaultAuditConflictResult
  push: UseVaultAuditPushResult
}

/**
 * The two writes a conflict can mean, kept side by side so the final click repeats the choice.
 *
 * The document side is still per file, while the database side is per finding. That difference is
 * shown in the two counts instead of making a row button look like it has a narrower effect than
 * the writer actually has.
 */
export function VaultAuditConflictActionBar({ conflict, push }: VaultAuditConflictActionBarProps) {
  const busy = conflict.applying || push.running
  const fileValues = conflict.selectedCount
  const bluePlmFiles = push.eligibility.eligible.length
  const nothingChosen = fileValues === 0 && push.eligibility.selected === 0

  return (
    <VaultAuditFooter
      note={{
        content: (
          <>
            <p>{t('vaultAudit.conflict.instruction')}</p>
            <p>{t('vaultAudit.conflict.bluePlmNote')}</p>
          </>
        ),
      }}
      messages={
        conflict.error && (
          <FooterMessage icon={AlertTriangle} tone="danger">
            {conflict.error}
          </FooterMessage>
        )
      }
      summary={
        nothingChosen ? (
          <span className="text-ui-fg-secondary">{t('vaultAudit.conflict.selectPromptShort')}</span>
        ) : (
          <span className="font-medium text-ui-fg">
            {[
              fileValues > 0 &&
                t('vaultAudit.conflict.fileChoice', { values: countOf('values', fileValues) }),
              push.eligibility.selected > 0 &&
                t('vaultAudit.conflict.bluePlmChoice', {
                  files: countOf('files', push.eligibility.selected),
                }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )
      }
      actions={
        <>
          {fileValues > 0 && (
            <Button
              variant={push.eligibility.selected > 0 ? 'secondary' : 'primary'}
              size="sm"
              loading={conflict.applying}
              icon={<Check size={13} />}
              onClick={() => void conflict.apply()}
              disabled={busy || !conflict.canApply}
            >
              {conflict.applying
                ? t('vaultAudit.conflict.applying')
                : t('vaultAudit.conflict.applyFilePhrase', { values: countOf('values', fileValues) })}
            </Button>
          )}
          {push.eligibility.selected > 0 && (
            <Button
              variant="primary"
              size="sm"
              loading={push.running}
              icon={<FileUp size={13} />}
              onClick={() => void push.run()}
              disabled={busy || !push.canRun}
            >
              {push.running
                ? t('vaultAudit.push.running')
                : t('vaultAudit.conflict.applyBluePlmPhrase', { files: countOf('files', bluePlmFiles) })}
            </Button>
          )}
        </>
      }
    />
  )
}
