/**
 * The one convention the audit cannot work out for itself.
 *
 * Some shops expect a part's revision property to be present in the model file; others have the
 * drawing carry it and the model never states one. On the second kind of vault every model in the
 * database holds a revision, no model file holds one, and the audit reports that as several hundred
 * documents standing behind their records — the largest category on the page, and every row of it
 * noise.
 *
 * Both conventions are legitimate, so this asks rather than guessing, and defaults to the drawing
 * because that is the more common arrangement and the more expensive one to get wrong: guessing
 * the other way puts a real finding in front of someone who can dismiss it, while this way round
 * the mistake is a finding for a document that is intentionally not expected to carry one. Either
 * way, revision remains driven by the file whenever the file carries it.
 *
 * ## Why the count is always on screen
 *
 * A filter with no visible effect is how a page comes to show a reassuring number over values it
 * decided not to mention, which is the failure the whole audit exists to avoid. The excluded count
 * is printed whenever it is not zero, next to the switch that produced it; the full explanation is
 * on hover, so it no longer fills a column of the page.
 */

import { Switch } from '@/components/core/ui'
import { t } from '@/lib/i18n'

interface VaultAuditRevisionRuleProps {
  expectRevisionOnModels: boolean
  /** Comparisons left out by the current setting. Zero when they are being shown. */
  hiddenCount: number
  onChange: (expect: boolean) => void
}

export function VaultAuditRevisionRule({
  expectRevisionOnModels,
  hiddenCount,
  onChange,
}: VaultAuditRevisionRuleProps) {
  const hint = t('vaultAudit.revisionRule.hint')
  return (
    <div className="flex items-center gap-2 text-[13px]" title={hint}>
      <Switch
        size="sm"
        checked={expectRevisionOnModels}
        onChange={onChange}
        aria-label={t('vaultAudit.revisionRule.label')}
      />
      <span className="text-ui-fg-secondary">{t('vaultAudit.revisionRule.short')}</span>
      {hiddenCount > 0 && (
        <span
          className="text-ui-fg-tertiary"
          title={t('vaultAudit.revisionRule.hidden', { count: hiddenCount })}
        >
          · {t('vaultAudit.revisionRule.hiddenShort', { count: hiddenCount })}
        </span>
      )}
    </div>
  )
}
