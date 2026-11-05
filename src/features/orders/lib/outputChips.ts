/**
 * The output chips of one order line: which kinds it sends and whether each is ready. A draft
 * shows every kind it could include (a click toggles it); a sent order shows what was recorded
 * when it went out (`sentOutputs`, `missingKinds`), never newer outputs.
 */

import {
  ORDER_OUTPUT_KINDS,
  type LineOutputState,
  type OrderOutputKind,
  type SupplyOrderLine,
} from '@/types/orders'

export type OutputChipState =
  /** Included, and an output exists (or was sent). */
  | 'ready'
  /** Included, and no output exists (or none was sent). */
  | 'missing'
  /** Included, missing, and requested: a desktop with SOLIDWORKS will generate it (5.13.0). */
  | 'requested'
  /** Included, and the line cannot have it (a PDF without a drawing). */
  | 'unsupported'
  /** Included, and the outputs are still being looked up. */
  | 'checking'
  /** Not included; offered in a draft. */
  | 'excluded'

export interface OutputChip {
  kind: OrderOutputKind
  state: OutputChipState
  /** A click adds or removes the kind (drafts only). */
  toggleable: boolean
  /** The output's file name, when known. */
  fileName: string | null
  /** With `requested`: the request's id (Cancel request) and who asked. */
  requestId?: string
  requestedBy?: string | null
}

type LineFields = Pick<SupplyOrderLine, 'outputKinds' | 'sentOutputs' | 'missingKinds'>

/** The chips of a line, in `ORDER_OUTPUT_KINDS` order. */
export function lineOutputChips(
  line: LineFields,
  states: readonly LineOutputState[] | undefined,
  editable: boolean,
): OutputChip[] {
  const chips: OutputChip[] = []
  for (const kind of ORDER_OUTPUT_KINDS) {
    const included = line.outputKinds.includes(kind)

    if (line.sentOutputs) {
      // A sent order: what went out, never what exists now.
      if (!included) continue
      const sent = line.sentOutputs.find((o) => o.kind === kind)
      chips.push({
        kind,
        state: sent ? 'ready' : 'missing',
        toggleable: false,
        fileName: sent?.fileName ?? null,
      })
      continue
    }

    const st = states?.find((s) => s.kind === kind)
    if (!included) {
      // Offer only kinds the line can have.
      if (editable && st?.status !== 'unsupported') {
        chips.push({ kind, state: 'excluded', toggleable: true, fileName: null })
      }
      continue
    }
    const state: OutputChipState = !st
      ? 'checking'
      : st.status === 'ready'
        ? 'ready'
        : st.status === 'unsupported'
          ? 'unsupported'
          : st.status === 'requested'
            ? 'requested'
            : 'missing'
    const chip: OutputChip = { kind, state, toggleable: editable, fileName: st?.output?.fileName ?? null }
    if (state === 'requested' && st?.request) {
      chip.requestId = st.request.id
      chip.requestedBy = st.request.requestedBy
    }
    chips.push(chip)
  }
  return chips
}

/** `kinds` with `kind` added or removed, in `ORDER_OUTPUT_KINDS` order. */
export function toggleOutputKind(
  kinds: readonly OrderOutputKind[],
  kind: OrderOutputKind,
): OrderOutputKind[] {
  const next = kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind]
  return ORDER_OUTPUT_KINDS.filter((k) => next.includes(k))
}

export interface LineMissing {
  line: SupplyOrderLine
  kinds: OrderOutputKind[]
}

/**
 * The included kinds with no ready output, per line, from the resolved states. Shown before an
 * order is sent; a line whose states are not known yet counts every included kind as missing,
 * so nothing is sent unchecked.
 */
export function missingOutputs(
  lines: readonly SupplyOrderLine[],
  statesByLine: Readonly<Record<string, readonly LineOutputState[]>> | undefined,
): LineMissing[] {
  const out: LineMissing[] = []
  for (const line of lines) {
    const states = statesByLine?.[line.id]
    const kinds = line.outputKinds.filter(
      (kind) => states?.find((s) => s.kind === kind)?.status !== 'ready',
    )
    if (kinds.length > 0) out.push({ line, kinds })
  }
  return out
}

/**
 * A line whose file was purged from the vault: only its snapshot (name, part number, revision,
 * version) is left, so it has no outputs to generate and no newer version to move to.
 */
export function isPurgedLine(line: Pick<SupplyOrderLine, 'fileId' | 'fileVersionId'>): boolean {
  return !line.fileId || !line.fileVersionId
}

/** The lines Generate missing and Update can act on (not purged). */
export function livingLines<T extends Pick<SupplyOrderLine, 'fileId' | 'fileVersionId'>>(
  lines: readonly T[],
): T[] {
  return lines.filter((l) => !isPurgedLine(l))
}

/** How many included outputs of the lines are missing in total. */
export function missingCount(missing: readonly LineMissing[]): number {
  return missing.reduce((n, m) => n + m.kinds.length, 0)
}

/** What the lines' included, missing outputs are waiting on. */
export interface MissingSplit {
  /** Missing and not requested: what Request missing would ask for. */
  unrequested: number
  /** Requested (pending or claimed). */
  requested: number
  /** The ids of the requests this user may cancel (`mayCancel`), for Cancel requests. */
  requestIds: string[]
}

/**
 * The included kinds of these lines that are missing, split into requested and not (resolved
 * states only; `source` is never generated or requested, so it is left out). Pure.
 */
export function splitMissing(
  lines: readonly SupplyOrderLine[],
  statesByLine: Readonly<Record<string, readonly LineOutputState[]>> | undefined,
  mayCancel: (requestedBy: string | null) => boolean = () => true,
): MissingSplit {
  const out: MissingSplit = { unrequested: 0, requested: 0, requestIds: [] }
  const ids = new Set<string>()
  for (const line of lines) {
    for (const st of statesByLine?.[line.id] ?? []) {
      if (!st.included || st.kind === 'source') continue
      if (st.status === 'missing') out.unrequested++
      else if (st.status === 'requested') {
        out.requested++
        if (st.request && !ids.has(st.request.id) && mayCancel(st.request.requestedBy)) {
          ids.add(st.request.id)
          out.requestIds.push(st.request.id)
        }
      }
    }
  }
  return out
}
