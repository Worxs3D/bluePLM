/**
 * Every key `RealignSection` / `RealignDialog` reads, asserted to exist in all 7 locales and to
 * interpolate where it takes a param. Follows `resolveMovesKeys.test.ts`'s pattern and
 * reasoning: a missing key is not a missing translation, it is the literal dotted key rendered
 * on screen, since `getTranslation` only falls back to a string when one was passed at the call
 * site (`index.ts`) — and every call in this feature passes a params object or nothing, never a
 * fallback string.
 */

import { describe, expect, it } from 'vitest'

import { getTranslation } from './index'
import type { Language } from './types'

const LOCALES: Language[] = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW']

/** Keys that render as-is, with no `{{placeholder}}`. */
const PLAIN = [
  'realign.section.heading',
  'realign.section.title',
  'realign.section.description',
  'realign.section.button',
  'realign.dialog.title',
  'realign.dialog.subtitle',
  'realign.dialog.waitingForConfirmation',
  'realign.runButton',
  'realign.headline.aligned',
  'realign.headline.notAligned',
  'realign.group.repairable',
  'realign.group.needsDecision',
  'realign.group.needsDecisionNote',
  'realign.group.needsDecisionEmpty',
  'realign.group.informational',
  'realign.syncIndex.label',
  'realign.syncIndex.description',
  'realign.pendingMove.description',
  'realign.pendingMove.keepServer',
  'realign.pendingMove.keepLocal',
  'realign.pendingMove.keepServerAll',
  'realign.pendingMove.keepLocalAll',
  'realign.pendingMove.keepLocalNote',
  'realign.orphaned.description',
  'realign.outdated.description',
  'realign.localOnly.description',
  'realign.localOnly.actionButton',
  'realign.modified.description',
  'realign.modified.actionButton',
  'realign.ghost.description',
  'realign.cloudOnly.whyNote',
  'realign.ignored.whyNote',
  'realign.blockedCheckout.whyNote',
  'realign.blockedCheckout.selfHeld_one',
  'realign.blockedCheckout.otherHeld_one',
  'realign.outcome.heading',
  'realign.outcome.abortedHeading',
  'realign.outcome.abortNoVault',
  'realign.outcome.abortOffline',
  'realign.outcome.abortOperationInFlight',
  'realign.outcome.abortCancelled',
  'realign.outcome.abortUnexpectedError',
  'realign.outcome.step_resolvePendingMoves',
  'realign.outcome.step_recycleOrphans',
  'realign.outcome.step_pullOutdated',
  'realign.outcome.step_rebuildSyncIndex',
  'realign.outcome.failedResult',
  'realign.outcome.nothingToDo',
  'realign.outcome.refused',
] as const

/** Keys whose sentence contains `{{count}}` (or another placeholder). */
const COUNTED = [
  'realign.moreFiles',
  'realign.orientation.local_one',
  'realign.orientation.local_other',
  'realign.orientation.server_one',
  'realign.orientation.server_other',
  'realign.orientation.inSync_one',
  'realign.orientation.inSync_other',
  'realign.pendingMove.label_one',
  'realign.pendingMove.label_other',
  'realign.pendingMove.adoptSummary_one',
  'realign.pendingMove.adoptSummary_other',
  'realign.pendingMove.reconcileSummary_one',
  'realign.pendingMove.reconcileSummary_other',
  'realign.orphaned.label_one',
  'realign.orphaned.label_other',
  'realign.outdated.label_one',
  'realign.outdated.label_other',
  'realign.localOnly.label_one',
  'realign.localOnly.label_other',
  'realign.modified.label_one',
  'realign.modified.label_other',
  'realign.ghost.label_one',
  'realign.ghost.label_other',
  'realign.cloudOnly.label_one',
  'realign.cloudOnly.label_other',
  'realign.ignored.label_one',
  'realign.ignored.label_other',
  'realign.blockedCheckout.label_one',
  'realign.blockedCheckout.label_other',
  'realign.blockedCheckout.selfHeld_other',
  'realign.blockedCheckout.otherHeld_other',
  'realign.outcome.ok_one',
  'realign.outcome.ok_other',
] as const

/** Toast strings shown after the dialog closes — plain, but only reachable via `t()` calls that
 * always pass no params, so they belong with `PLAIN` in spirit; kept separate only to document
 * which flow reads them. */
const ACTION_TOASTS = ['realign.localOnly.actionToast', 'realign.modified.actionToast'] as const

describe('realign.* keys exist in every locale', () => {
  it.each(LOCALES)('%s resolves every plain key to a sentence rather than the key', (locale) => {
    for (const key of [...PLAIN, ...ACTION_TOASTS]) {
      const text = getTranslation(locale, key)
      expect(text, `${locale}: ${key}`).not.toBe(key)
      expect(text.length, `${locale}: ${key}`).toBeGreaterThan(0)
    }
  })

  it.each(LOCALES)('%s resolves every counted key and substitutes the count', (locale) => {
    for (const key of COUNTED) {
      const text = getTranslation(locale, key, { count: 42 })
      expect(text, `${locale}: ${key}`).not.toBe(key)
      expect(text, `${locale}: ${key}`).toContain('42')
      expect(text, `${locale}: ${key}`).not.toMatch(/\{\{\w+\}\}/)
    }
  })

  it('leaves no placeholder unfilled in the partial-outcome line', () => {
    const text = getTranslation('en', 'realign.outcome.partial', {
      succeeded: 3,
      attempted: 5,
      failed: 2,
    })

    expect(text).toContain('3')
    expect(text).toContain('5')
    expect(text).toContain('2')
    expect(text).not.toMatch(/\{\{\w+\}\}/)
  })

  it('serves the English text to a locale that has not translated these yet', () => {
    // pt / zh-CN / zh-TW carry the English text verbatim for this feature; getTranslation
    // falls back to the English dictionary per key rather than per file (see newKeys.test.ts).
    expect(getTranslation('zh-CN', 'realign.dialog.title')).toBe(
      getTranslation('en', 'realign.dialog.title'),
    )
    expect(getTranslation('zh-TW', 'realign.outcome.abortOffline')).toBe(
      getTranslation('en', 'realign.outcome.abortOffline'),
    )
    expect(getTranslation('pt', 'realign.localOnly.actionToast')).toBe(
      getTranslation('en', 'realign.localOnly.actionToast'),
    )
  })

  it('gives German, Spanish and French their own text, not the English fallback', () => {
    for (const locale of ['de', 'es', 'fr'] as Language[]) {
      expect(getTranslation(locale, 'realign.dialog.title')).not.toBe(
        getTranslation('en', 'realign.dialog.title'),
      )
    }
  })
})
