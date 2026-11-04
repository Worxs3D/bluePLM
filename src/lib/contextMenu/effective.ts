/**
 * The layout a person's menu follows, from the layers in `types.ts`:
 *   own full layout (`custom`) > pins and hidden over the template (`quick`) > the template they
 *   picked > the organization's default template > the app default.
 *
 * - A picked template that no longer exists falls back to the organization default (and that to
 *   the app default); `APP_DEFAULT_TEMPLATE_ID` picks the app default on purpose.
 * - When an admin chose "Apply to everyone now" (`forced_at`), a person's custom layout, pins and
 *   hidden entries last changed before it are set aside (`setAsideByForce`) until they keep them
 *   (`keptAfterForce` at or after `forced_at`) or change them again. The picked template stays.
 * - The result is always `completeLayout`'d, so entries of a newer app are never lost.
 * - Admin-only entries are ordinary entries here: whether one shows is the menu's availability
 *   check, so the layout does not depend on who is looking.
 */

import { completeLayout } from './complete'
import { DEFAULT_LAYOUT, type ContextMenuEntryId } from './entries'
import { layoutHash } from './hash'
import { isContextMenuPrefsKey, sanitizeOrgContextMenu } from './sanitize'
import {
  APP_DEFAULT_TEMPLATE_ID,
  NO_ORG_KEY,
  type LayoutNode,
  type MenuLayout,
  type OrgContextMenuSettings,
  type OrgMenuTemplate,
  type UserContextMenuPrefs,
} from './types'

export { layoutHash } from './hash'

/** What the layer functions need of an organization. */
export interface ContextMenuOrgLike {
  settings?: { context_menu?: unknown } | null
}

/** The key of `contextMenuPrefs` for an organization: its id, or `NO_ORG_KEY` without one. */
export function orgKey(orgId: string | null | undefined): string {
  return isContextMenuPrefsKey(orgId) ? orgId : NO_ORG_KEY
}

const sanitizedCache = new WeakMap<object, OrgContextMenuSettings | null>()

/** The organization's menu settings, sanitized (cached per settings object). */
export function orgTemplates(org: ContextMenuOrgLike | null | undefined): {
  settings: OrgContextMenuSettings | null
  templates: OrgMenuTemplate[]
} {
  const raw = org?.settings?.context_menu
  let settings: OrgContextMenuSettings | null
  if (typeof raw === 'object' && raw !== null) {
    if (sanitizedCache.has(raw)) settings = sanitizedCache.get(raw) ?? null
    else {
      settings = sanitizeOrgContextMenu(raw)
      sanitizedCache.set(raw, settings)
    }
  } else {
    settings = null
  }
  return { settings, templates: settings?.templates ?? [] }
}

function removeEntries(nodes: readonly LayoutNode[], ids: ReadonlySet<string>): LayoutNode[] {
  const out: LayoutNode[] = []
  for (const node of nodes) {
    if (node.kind === 'entry') {
      if (!ids.has(node.id)) out.push(node)
    } else if (node.kind === 'group') {
      out.push({ ...node, children: removeEntries(node.children, ids) })
    } else {
      out.push(node)
    }
  }
  return out
}

/**
 * `layout` with `pinned` taken from where they are and put first, in that order, then a
 * separator; and `hidden` taken out of the menu into `hidden`. An entry in both stays pinned.
 */
export function applyQuickPrefs(
  layout: MenuLayout,
  pinned: readonly ContextMenuEntryId[],
  hidden: readonly ContextMenuEntryId[],
): MenuLayout {
  const pins = [...new Set(pinned)]
  const pinSet = new Set<string>(pins)
  const hide = [...new Set(hidden)].filter((id) => !pinSet.has(id))
  if (pins.length === 0 && hide.length === 0) return layout
  const taken = new Set<string>([...pins, ...hide])
  const rest = removeEntries(layout.nodes, taken)
  const head: LayoutNode[] = pins.map((id) => ({ kind: 'entry', id }))
  const nodes = pins.length > 0 ? [...head, { kind: 'separator' } as LayoutNode, ...rest] : rest
  const hiddenOut = [...layout.hidden.filter((id) => !pinSet.has(id))]
  for (const id of hide) if (!hiddenOut.includes(id)) hiddenOut.push(id)
  return { ...layout, nodes, hidden: hiddenOut }
}

export type EffectiveSource = 'custom' | 'quick' | 'template' | 'org-default' | 'app'

export interface EffectiveLayout {
  /** Completed; what the menu resolves. */
  layout: MenuLayout
  source: EffectiveSource
  /**
   * The template the person follows (or, with `custom`, the one it was made from while that
   * still exists); null = the app default.
   */
  template: OrgMenuTemplate | null
  /** `layoutHash` of that template's current layout (or of `DEFAULT_LAYOUT`): store it as `customizedFrom.baseHash`. */
  baseHash: string
  /** `custom` was made from a template whose layout has changed since. */
  templateChangedSinceCustomized: boolean
  /** The person's own layout or pins exist but an admin's "Apply to everyone now" set them aside. */
  setAsideByForce: boolean
}

function hasOwnLayout(prefs: UserContextMenuPrefs): boolean {
  return prefs.custom !== null || prefs.pinned.length > 0 || prefs.hidden.length > 0
}

function timeOf(value: string | undefined): number {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY
}

/** The person's own layout was made before the admin's force and not kept since. */
export function isSetAsideByForce(
  settings: OrgContextMenuSettings | null,
  prefs: UserContextMenuPrefs | undefined,
): boolean {
  if (!prefs || !settings?.forced_at || !hasOwnLayout(prefs)) return false
  const forced = timeOf(settings.forced_at)
  if (timeOf(prefs.keptAfterForce) >= forced) return false
  return timeOf(prefs.updatedAt) < forced
}

/** The template a template id names: undefined = none by that id, null = the app default. */
function findTemplate(templates: readonly OrgMenuTemplate[], id: string | null | undefined): OrgMenuTemplate | null | undefined {
  if (id === APP_DEFAULT_TEMPLATE_ID) return null
  if (!id) return undefined
  return templates.find((template) => template.id === id)
}

export function effectiveLayout(
  org: ContextMenuOrgLike | null | undefined,
  prefs: UserContextMenuPrefs | undefined,
): EffectiveLayout {
  const { settings, templates } = orgTemplates(org)

  // The template followed: picked > organization default > app default.
  let template: OrgMenuTemplate | null = null
  let source: EffectiveSource = 'app'
  const picked = findTemplate(templates, prefs?.templateId)
  if (picked !== undefined) {
    template = picked
    source = picked ? 'template' : 'app'
  } else {
    const orgDefault = findTemplate(templates, settings?.default_template_id)
    if (orgDefault) {
      template = orgDefault
      source = 'org-default'
    }
  }

  const setAsideByForce = isSetAsideByForce(settings, prefs)
  const own = prefs && !setAsideByForce ? prefs : undefined

  if (own?.custom) {
    // Compare with the template the copy was made from, while it exists.
    const from = own.customizedFrom ? findTemplate(templates, own.customizedFrom.templateId) : undefined
    const base = from !== undefined ? from : template
    const baseHash = layoutHash(base ? base.layout : DEFAULT_LAYOUT)
    return {
      layout: completeLayout(own.custom),
      source: 'custom',
      template: base,
      baseHash,
      templateChangedSinceCustomized: from !== undefined && baseHash !== own.customizedFrom?.baseHash,
      setAsideByForce,
    }
  }

  const baseLayout = template ? template.layout : DEFAULT_LAYOUT
  const baseHash = layoutHash(baseLayout)
  const completed = completeLayout(baseLayout)
  if (own && (own.pinned.length > 0 || own.hidden.length > 0)) {
    return {
      layout: applyQuickPrefs(completed, own.pinned, own.hidden),
      source: 'quick',
      template,
      baseHash,
      templateChangedSinceCustomized: false,
      setAsideByForce,
    }
  }
  return { layout: completed, source, template, baseHash, templateChangedSinceCustomized: false, setAsideByForce }
}
