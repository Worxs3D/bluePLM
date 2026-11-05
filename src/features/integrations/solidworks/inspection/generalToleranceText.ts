import { t } from '@/lib/i18n'
import type { GeneralToleranceBasis } from '@/lib/inspection/generalTolerance'

/** The rule behind a general tolerance, in words (`2-place decimals ±.01`, `ISO 2768-m, ...`). */
export function generalToleranceRuleText(basis: GeneralToleranceBasis): string {
  switch (basis.kind) {
    case 'decimal':
      return t('source.inspection.gtRuleDecimal', { places: basis.places, tolerance: basis.tolerance })
    case 'linear':
      return t('source.inspection.gtRuleLinear', { tolerance: basis.tolerance })
    case 'fractional':
      return t('source.inspection.gtRuleFractional', { tolerance: basis.tolerance })
    case 'angular':
      return basis.places === undefined
        ? t('source.inspection.gtRuleAngular', { tolerance: basis.tolerance })
        : t('source.inspection.gtRuleAngularDecimal', { places: basis.places, tolerance: basis.tolerance })
    case 'iso2768': {
      const { over, upTo } = basis.rangeMm
      const range =
        upTo === null
          ? t('source.inspection.gtRangeOpen', { over })
          : over === 0.5
            ? t('source.inspection.gtRangeFirst', { over, upTo })
            : t('source.inspection.gtRangeOver', { over, upTo })
      return t('source.inspection.gtRuleIso', {
        cls: basis.cls,
        table: basis.table,
        range,
        tolerance: basis.toleranceMm,
      })
    }
  }
}

/** Tooltip of the GT marker: the rule when this session's extraction knows it. */
export function generalToleranceTitle(basis: GeneralToleranceBasis | undefined): string {
  return basis
    ? t('source.inspection.generalTolerance', { rule: generalToleranceRuleText(basis) })
    : t('source.inspection.generalToleranceUnknownRule')
}
