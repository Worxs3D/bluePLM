import type { AppliedInspectionBalloons } from '@/lib/inspection/types'

/** One sentence of a toast: an i18n key under `source.inspection` and its values. */
export interface BalloonMessagePart {
  key: string
  values: Record<string, number>
}

/** A toast the Balloon flow shows; its parts are joined with a space. */
export interface BalloonToast {
  kind: 'success' | 'info' | 'warning'
  parts: BalloonMessagePart[]
}

/** What the Balloon flow does with a successful `applyInspectionBalloons` reply. */
export interface BalloonOutcome {
  /**
   * `unchanged`: the service (1.29.0 and later) changed and saved nothing, so the drawing as it is
   * now is the ballooned state. `saved`: the service saved the drawing. `notSaved`: the balloons
   * went in but the save failed.
   */
  status: 'unchanged' | 'saved' | 'notSaved'
  toasts: BalloonToast[]
}

/**
 * Toasts and status for a successful reply. An Auto run that changed nothing stays quiet, also
 * about missing characteristics, which it would otherwise repeat on every save. A service before
 * 1.29.0 sends neither `kept` nor `unchanged`: it replaced every balloon, so the reply reads as
 * before ("placed N, replaced K").
 */
export function balloonOutcome(data: AppliedInspectionBalloons, auto: boolean): BalloonOutcome {
  const { placed, missing, removedPrevious, keptPositions, kept, unchanged, saved } = data
  const missingToast: BalloonToast[] =
    missing.length > 0
      ? [{ kind: 'warning', parts: [{ key: 'balloonMissing', values: { count: missing.length } }] }]
      : []

  if (unchanged === true) {
    if (auto) return { status: 'unchanged', toasts: [] }
    return {
      status: 'unchanged',
      toasts: [
        { kind: 'info', parts: [{ key: 'balloonUnchanged', values: { kept: kept ?? 0 } }] },
        ...missingToast,
      ],
    }
  }

  if (!saved) {
    return {
      status: 'notSaved',
      toasts: [{ kind: 'warning', parts: [{ key: 'balloonNotSaved', values: { placed } }] }],
    }
  }

  const parts: BalloonMessagePart[] =
    kept === undefined
      ? [
          { key: 'balloonApplied', values: { placed, removedPrevious } },
          ...(keptPositions > 0
            ? [{ key: 'balloonKeptPositions', values: { count: keptPositions } }]
            : []),
        ]
      : [{ key: 'balloonUpdated', values: { kept, placed, removed: removedPrevious } }]
  const applied: BalloonToast[] = [{ kind: 'success', parts }]
  return { status: 'saved', toasts: [...applied, ...missingToast] }
}
