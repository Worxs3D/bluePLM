/**
 * Copy the conflict choices out as a table, and paste a table back in as choices.
 *
 * The rules for what a pasted line has to match live in `conflictChoicesTable.ts`; this file only
 * shows what a paste would do before it does it. Setting the choices writes nothing: the footer's
 * Write button still does that, with its own checkout and verification.
 */

import { useMemo, useState } from 'react'
import { ClipboardCopy, ClipboardPaste } from 'lucide-react'

import { Dialog } from '@/components/core/Dialog'
import { Button, TextArea } from '@/components/core/ui'
import { copyToClipboard } from '@/lib/clipboard'
import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import type { VaultAuditFinding } from '@/types/vaultAudit'

import {
  formatConflictChoicesTable,
  parseConflictChoicesTable,
  planConflictChoices,
  type ChoiceLineError,
  type ChoiceSkipReason,
  type ConflictChoiceRules,
  type ConflictChoiceState,
  type ConflictChoicesPlan,
} from './conflictChoicesTable'
import { countOf } from './vaultAuditLabels'

/** Enough to see what went wrong; the count says how many more there are. */
const SKIPPED_SHOWN = 40

const TOOL_BUTTON =
  'inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[13px] text-ui-fg-secondary hover:bg-ui-hover hover:text-ui-fg disabled:opacity-50'

function skipReasonLabel(reason: ChoiceSkipReason): string {
  switch (reason) {
    case 'no-such-file':
      return t('vaultAudit.choicesTable.skipNoSuchFile')
    case 'ambiguous-file':
      return t('vaultAudit.choicesTable.skipAmbiguousFile')
    case 'no-such-value':
      return t('vaultAudit.choicesTable.skipNoSuchValue')
    case 'value-changed':
      return t('vaultAudit.choicesTable.skipValueChanged')
    case 'needs-field':
      return t('vaultAudit.choicesTable.skipNeedsField')
    case 'mixed-choices':
      return t('vaultAudit.choicesTable.skipMixedChoices')
    case 'not-available':
      return t('vaultAudit.choicesTable.skipNotAvailable')
  }
}

function lineErrorLabel(error: ChoiceLineError): string {
  switch (error) {
    case 'no-header':
      return t('vaultAudit.choicesTable.errorNoHeader')
    case 'no-file-column':
      return t('vaultAudit.choicesTable.errorNoFileColumn')
    case 'no-choice-column':
      return t('vaultAudit.choicesTable.errorNoChoiceColumn')
    case 'unreadable-line':
      return t('vaultAudit.choicesTable.errorUnreadableLine')
    case 'unknown-field':
      return t('vaultAudit.choicesTable.errorUnknownField')
    case 'unknown-choice':
      return t('vaultAudit.choicesTable.errorUnknownChoice')
  }
}

interface VaultAuditChoicesTableProps {
  findings: readonly VaultAuditFinding[]
  state: ConflictChoiceState
  rules: ConflictChoiceRules
  disabled: boolean
  onApply: (plan: ConflictChoicesPlan) => void
}

export function VaultAuditChoicesTable({
  findings,
  state,
  rules,
  disabled,
  onApply,
}: VaultAuditChoicesTableProps) {
  const addToast = usePDMStore((s) => s.addToast)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')

  const conflictCount = useMemo(
    () => findings.filter((finding) => finding.resolution === 'choose-a-side').length,
    [findings],
  )

  const parsed = useMemo(() => parseConflictChoicesTable(text), [text])
  const plan = useMemo(
    () => planConflictChoices(parsed.lines, findings, rules),
    [parsed.lines, findings, rules],
  )

  const handleCopy = async () => {
    const result = await copyToClipboard(formatConflictChoicesTable(findings, state))
    if (result.success) {
      addToast('success', t('vaultAudit.choicesTable.copied', { count: conflictCount }))
    } else {
      addToast('error', t('vaultAudit.choicesTable.copyFailed'))
    }
  }

  const close = () => {
    setOpen(false)
    setText('')
  }

  const chosen = plan.bluePlmFileIds.length + plan.fileFindingIds.length
  const summary = t('vaultAudit.choicesTable.summary', {
    files: countOf('files', plan.bluePlmFileIds.length),
    values: countOf('values', plan.fileFindingIds.length),
  })

  const handleApply = () => {
    onApply(plan)
    addToast('success', t('vaultAudit.choicesTable.appliedToast', { summary }))
    close()
  }

  const problems = [
    ...parsed.errors.map((error) => ({
      line: error.line,
      label: lineErrorLabel(error.error),
      detail: error.text.trim(),
    })),
    ...plan.skipped.map((skip) => ({
      line: skip.line,
      label: skipReasonLabel(skip.reason),
      detail: skip.path,
    })),
  ].sort((a, b) => a.line - b.line)

  return (
    <>
      <button
        type="button"
        onClick={() => void handleCopy()}
        disabled={disabled || conflictCount === 0}
        title={t('vaultAudit.choicesTable.copyHint')}
        className={TOOL_BUTTON}
      >
        <ClipboardCopy size={13} />
        {t('vaultAudit.choicesTable.copy')}
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || conflictCount === 0}
        title={t('vaultAudit.choicesTable.pasteHint')}
        className={TOOL_BUTTON}
      >
        <ClipboardPaste size={13} />
        {t('vaultAudit.choicesTable.paste')}
      </button>

      <Dialog
        open={open}
        onClose={close}
        title={t('vaultAudit.choicesTable.title')}
        className="max-w-3xl"
      >
        <div className="flex flex-col gap-3 text-[13px]">
          <p className="text-ui-fg-secondary">{t('vaultAudit.choicesTable.instruction')}</p>
          <TextArea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('vaultAudit.choicesTable.placeholder')}
            rows={10}
            spellCheck={false}
            className="font-mono text-[12px]"
          />

          {text.trim() !== '' && (
            <>
              <p className="font-medium text-ui-fg">
                {chosen > 0 ? summary : t('vaultAudit.choicesTable.nothing')}
              </p>
              {problems.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-ui-divider px-3 py-2">
                  <p className="mb-1 text-ui-fg-secondary">
                    {t('vaultAudit.choicesTable.skippedHeading', { count: problems.length })}
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {problems.slice(0, SKIPPED_SHOWN).map((problem, index) => (
                      <li key={`${problem.line}-${index}`} className="text-ui-fg-secondary">
                        <span className="tabular-nums text-ui-fg-tertiary">
                          {t('vaultAudit.choicesTable.line', { line: problem.line })}
                        </span>{' '}
                        {problem.label}
                        {problem.detail && (
                          <span className="text-ui-fg-tertiary"> — {problem.detail}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {problems.length > SKIPPED_SHOWN && (
                    <p className="mt-1 text-ui-fg-tertiary">
                      {t('vaultAudit.choicesTable.more', {
                        count: problems.length - SKIPPED_SHOWN,
                      })}
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          <p className="text-ui-fg-tertiary">{t('vaultAudit.choicesTable.note')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={close}>
              {t('vaultAudit.choicesTable.cancel')}
            </Button>
            <Button variant="primary" size="sm" onClick={handleApply} disabled={chosen === 0}>
              {t('vaultAudit.choicesTable.apply')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
