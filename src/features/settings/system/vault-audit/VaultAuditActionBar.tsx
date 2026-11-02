/**
 * The button for whatever the selected category resolves as, and everything that has to be said
 * before it is pressed.
 *
 * There is one bar rather than one control per row because a category is a single direction, and
 * because both writers behind it are batch operations - a per-row button would be a click per
 * value with no way to see the whole set first, which is the argument that removed the per-row
 * repair button in the first place.
 *
 * The two directions are not symmetrical and the bar does not pretend they are.
 *
 * **Into the database** is bounded by the SQL behind it: the merge is `computed || existing` in a
 * `SECURITY DEFINER` function, so it can add a configuration entry and cannot overwrite one. That
 * guarantee is stated above the button rather than in a confirmation, because it is the reason a
 * bulk write to production metadata is a reasonable thing to offer, and it should be checkable
 * against the receipt afterwards.
 *
 * **Into the file** is the Sync Metadata command, which rebuilds every BluePLM-owned property except
 * file-driven revision in the documents it is given and will only touch a file that is local-only or
 * checked out by you. Both facts are stated before the click: the first because ticking one
 * description and changing a part number would otherwise be a surprise, and the second because a
 * vault-wide audit routinely selects hundreds of files of which almost none are checked out, and a
 * run that quietly processed the eligible eighth would leave the vault looking done.
 */

import type { ReactNode } from 'react'
import { AlertTriangle, Check, FileUp, Lock, ShieldCheck, Sparkles } from 'lucide-react'

import { Button } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import type { VaultAuditRepairOutcome } from '@/types/vaultAudit'

import { describeShortfall } from './repairReceipt'
import type { UseVaultAuditPushResult } from './useVaultAuditPush'
import { FooterMessage, VaultAuditFooter } from './VaultAuditFooter'
import type { UseVaultAuditRepairResult } from './useVaultAuditRepair'
import type { VaultAuditActionKind } from './vaultAuditActions'
import { countOf } from './vaultAuditLabels'

interface VaultAuditActionBarProps {
  /** What this category's rows resolve as, or null when none of them can be acted on. */
  action: VaultAuditActionKind | null
  repair: UseVaultAuditRepairResult
  push: UseVaultAuditPushResult
  /** The selection controls, from the findings list. */
  selection: ReactNode
}

function Receipt({ outcome }: { outcome: VaultAuditRepairOutcome }) {
  // Broken out by reason rather than reported as one number. Fewer entries landing than were asked
  // for is the normal result of applying against a row that has moved on - but it is also what an
  // unreachable file looks like, and this panel used to describe both as "already there".
  const shortfall = describeShortfall(outcome)
  const refused = outcome.files.filter((file) => file.refused !== null)

  return (
    <div className="space-y-1.5">
      <p className="text-[14px] text-ui-fg flex items-center gap-1.5">
        <Check size={14} className="text-ui-success flex-shrink-0" />
        {t('vaultAudit.repair.receiptHeading', {
          entries: outcome.entriesAdded,
          files: outcome.filesUpdated,
        })}
      </p>
      {shortfall.alreadyPresent > 0 && (
        <p className="text-[13px] text-ui-fg-secondary">
          {t('vaultAudit.repair.receiptShortfall', {
            count: shortfall.alreadyPresent,
            requested: outcome.entriesRequested,
          })}
        </p>
      )}
      {shortfall.noRecord > 0 && (
        <p className="text-[13px] text-ui-fg-secondary">
          {t('vaultAudit.repair.receiptNoRecord', { count: shortfall.noRecord })}
        </p>
      )}
      {refused.length > 0 && (
        <p className="text-[13px] text-ui-warning flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span>
            {t('vaultAudit.repair.receiptRefused', { count: refused.length })}
            {shortfall.unreachable > 0 && (
              <> {t('vaultAudit.repair.receiptEntriesDropped', { count: shortfall.unreachable })}</>
            )}
          </span>
        </p>
      )}
    </div>
  )
}

function WriteToVaultBar({
  repair,
  selection,
}: {
  repair: UseVaultAuditRepairResult
  selection: ReactNode
}) {
  const { entries, files, derived } = repair.selected
  return (
    <VaultAuditFooter
      note={{ icon: ShieldCheck, content: <p>{t('vaultAudit.repair.guarantee')}</p> }}
      messages={
        <>
          <label className="flex items-start gap-2 text-[13px] text-ui-fg-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={repair.includeDerivedTabs}
              disabled={repair.applying}
              onChange={(event) => repair.setIncludeDerivedTabs(event.target.checked)}
              className="mt-1 accent-ui-accent"
              title={t('vaultAudit.repair.includeDerivedHint')}
            />
            <span title={t('vaultAudit.repair.includeDerivedHint')}>
              <Sparkles size={11} className="mr-1 inline text-ui-warning" />
              {t('vaultAudit.repair.includeDerived')}
            </span>
          </label>
          {repair.error && (
            <FooterMessage icon={AlertTriangle} tone="danger">
              {repair.error}
            </FooterMessage>
          )}
          {derived > 0 && (
            <FooterMessage icon={Sparkles}>
              {t('vaultAudit.repair.selectedPhrase', {
                entries: countOf('entries', entries),
                files: countOf('files', files),
              })}
              {' · '}
              {t('vaultAudit.repair.derivedPhrase', { count: derived })}
            </FooterMessage>
          )}
          {repair.outcome && <Receipt outcome={repair.outcome} />}
        </>
      }
      summary={
        selection ?? (
          <span className="text-ui-fg-secondary">{t('vaultAudit.repair.selectPromptShort')}</span>
        )
      }
      actions={
        <Button
          variant="primary"
          size="sm"
          loading={repair.applying}
          icon={<Check size={13} />}
          onClick={() => void repair.apply()}
          disabled={!repair.canApply}
        >
          {repair.applying
            ? t('vaultAudit.repair.applying')
            : entries > 0
              ? t('vaultAudit.repair.applyPhrase', { entries: countOf('entries', entries) })
              : t('vaultAudit.repair.applyNone')}
        </Button>
      }
    />
  )
}

function WriteToFileBar({ push, selection }: { push: UseVaultAuditPushResult; selection: ReactNode }) {
  const { eligibility } = push
  const eligible = eligibility.eligible.length

  return (
    <VaultAuditFooter
      note={{ icon: FileUp, content: <p>{t('vaultAudit.push.wholeFileNote')}</p> }}
      messages={
        <>
          {push.heldByOthers.size > 0 && (
            <FooterMessage icon={Lock}>
              {t('vaultAudit.push.heldByOthers', { count: push.heldByOthers.size })}
            </FooterMessage>
          )}
          {eligibility.selected > 0 && eligible < eligibility.selected && (
            <FooterMessage>
              {t('vaultAudit.push.eligible', { eligible, selected: eligibility.selected })}
            </FooterMessage>
          )}
          {/* Separate from the lock above because this one is yours to clear: these files are in
              BluePLM and nobody is holding them, so a checkout makes them writable. */}
          {eligibility.selected > 0 && eligibility.tally.notCheckedOut > 0 && (
            <FooterMessage icon={AlertTriangle} tone="warning">
              {t('vaultAudit.push.notCheckedOut', { count: eligibility.tally.notCheckedOut })}
            </FooterMessage>
          )}
          {eligibility.selected > 0 && eligibility.tally.notLoaded > 0 && (
            <FooterMessage>{t('vaultAudit.push.notLoaded', { count: eligibility.tally.notLoaded })}</FooterMessage>
          )}
        </>
      }
      summary={selection ?? <span className="text-ui-fg-secondary">{t('vaultAudit.push.selectPromptShort')}</span>}
      actions={
        <Button
          variant="primary"
          size="sm"
          loading={push.running}
          icon={<FileUp size={13} />}
          onClick={() => void push.run()}
          disabled={!push.canRun}
        >
          {push.running
            ? t('vaultAudit.push.running')
            : eligible > 0
              ? t('vaultAudit.push.applyPhrase', { files: countOf('files', eligible) })
              : t('vaultAudit.push.applyNone')}
        </Button>
      }
    />
  )
}

export function VaultAuditActionBar({ action, repair, push, selection }: VaultAuditActionBarProps) {
  if (action === null) {
    return (
      <VaultAuditFooter
        summary={<span className="text-ui-fg-secondary">{t('vaultAudit.findings.noneAvailableShort')}</span>}
      />
    )
  }
  if (action === 'write-to-vault') return <WriteToVaultBar repair={repair} selection={selection} />
  return <WriteToFileBar push={push} selection={selection} />
}
