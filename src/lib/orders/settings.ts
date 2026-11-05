/**
 * The organization's Orders settings (5.13.0), `organization.settings.orders`, edited in
 * Settings > Orders: the order number prefix (`supply_order_create_row` reads it, schema 513) and
 * the output kinds a new line starts with, per kind of line. Untrusted JSON: read it through
 * `orderSettingsFromOrg`, which applies the defaults and drops anything a line cannot have.
 */

import { ORDER_OUTPUT_KINDS, type AddLineInput, type OrderOutputKind } from '@/types/orders'
import type { OrderOrgSettings, OrgSettings } from '@/types/pdm'

import { DRAWING_LINE_KINDS, DRAWING_ONLY_LINE_KINDS, MODEL_LINE_KINDS } from './plan'

/** The three kinds of line a planner makes, each with its own default kinds. */
export type OrderLineClass = 'drawing' | 'model_with_drawing' | 'model'

export const ORDER_LINE_CLASSES: readonly OrderLineClass[] = ['model_with_drawing', 'model', 'drawing']

/** The prefix the server uses when none is set (`supply_order_create_row`). */
export const DEFAULT_ORDER_NUMBER_PREFIX = 'ORD-'
/** The server keeps the first 40 characters. */
export const MAX_ORDER_NUMBER_PREFIX = 40

/**
 * The kinds each class of line can carry: PDF and DXF need a drawing, IGES and STL a model (the
 * rule of `lineKindApplies`). A drawing-only line is offered its drawing outputs and its source.
 */
export const LINE_CLASS_KINDS: Readonly<Record<OrderLineClass, readonly OrderOutputKind[]>> = {
  model_with_drawing: ORDER_OUTPUT_KINDS,
  model: ['step', 'iges', 'stl', 'source'],
  drawing: ['pdf', 'dxf', 'source'],
}

const BUILT_IN: Readonly<Record<OrderLineClass, readonly OrderOutputKind[]>> = {
  model_with_drawing: DRAWING_LINE_KINDS,
  model: MODEL_LINE_KINDS,
  drawing: DRAWING_ONLY_LINE_KINDS,
}

export interface OrderSettings {
  /** As the server will use it: trimmed, at most 40 characters, the default when blank. */
  numberPrefix: string
  defaultKinds: Record<OrderLineClass, OrderOutputKind[]>
}

function kindsOf(v: unknown, lineClass: OrderLineClass): OrderOutputKind[] {
  if (!Array.isArray(v)) return [...BUILT_IN[lineClass]]
  const allowed = LINE_CLASS_KINDS[lineClass]
  // In ORDER_OUTPUT_KINDS order; an empty list is a choice (send nothing until a kind is picked).
  return ORDER_OUTPUT_KINDS.filter((k) => allowed.includes(k) && v.includes(k))
}

/** The prefix as `supply_order_create_row` applies it. Pure. */
export function normalizeOrderPrefix(v: unknown): string {
  const text = typeof v === 'string' ? v.trim() : ''
  return text === '' ? DEFAULT_ORDER_NUMBER_PREFIX : text.slice(0, MAX_ORDER_NUMBER_PREFIX)
}

/** `organization.settings.orders` with the defaults applied. Pure. */
export function orderSettingsFromOrg(settings: Pick<OrgSettings, 'orders'> | null | undefined): OrderSettings {
  const raw: OrderOrgSettings =
    settings && typeof settings.orders === 'object' && settings.orders !== null ? settings.orders : {}
  const kinds = typeof raw.default_kinds === 'object' && raw.default_kinds !== null ? raw.default_kinds : {}
  return {
    numberPrefix: normalizeOrderPrefix(raw.number_prefix),
    defaultKinds: {
      model_with_drawing: kindsOf(kinds.model_with_drawing, 'model_with_drawing'),
      model: kindsOf(kinds.model, 'model'),
      drawing: kindsOf(kinds.drawing, 'drawing'),
    },
  }
}

/** The number an order gets: the prefix and the sequence, padded to 4 digits (as the server does). */
export function formatOrderNumber(prefix: string, sequence: number): string {
  const n = String(Math.max(0, Math.trunc(sequence)))
  return `${normalizeOrderPrefix(prefix)}${n.length >= 4 ? n : n.padStart(4, '0')}`
}

function sameKinds(a: readonly OrderOutputKind[] | undefined, b: readonly OrderOutputKind[]): boolean {
  return !!a && a.length === b.length && a.every((k) => b.includes(k))
}

/**
 * The planner's lines with the organization's default kinds. The planner gives each class its
 * built-in kinds (`DRAWING_LINE_KINDS`, `MODEL_LINE_KINDS`, `DRAWING_ONLY_LINE_KINDS`), so a line is
 * classed by what it carries: with a drawing version it is a model with a drawing; without one,
 * `{pdf}` is a drawing-only line and `{step}` a model. A line whose kinds are none of these (set on
 * purpose by a caller) is left alone. Pure.
 */
export function applyDefaultKinds(lines: readonly AddLineInput[], settings: OrderSettings): AddLineInput[] {
  return lines.map((line) => {
    const kinds = line.outputKinds
    let lineClass: OrderLineClass | null = null
    if (line.drawingVersionId) {
      if (sameKinds(kinds, DRAWING_LINE_KINDS)) lineClass = 'model_with_drawing'
    } else if (sameKinds(kinds, DRAWING_ONLY_LINE_KINDS)) lineClass = 'drawing'
    else if (sameKinds(kinds, MODEL_LINE_KINDS)) lineClass = 'model'
    return lineClass ? { ...line, outputKinds: [...settings.defaultKinds[lineClass]] } : line
  })
}
