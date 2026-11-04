/**
 * Turns untrusted layout JSON (organization settings, local storage, an imported file) into a
 * layout the menu can trust. Nothing here throws: what cannot be read is dropped.
 *
 * Rules (`types.ts` has the limits):
 * - unknown entry ids, unknown fields and duplicates are dropped (the first place wins);
 * - a group deeper than `MAX_GROUP_DEPTH` is dissolved and its children lifted into its parent;
 *   only top-level groups keep `collapsed` / `auto`, deeper ones become `inline`;
 * - a group may claim a built-in id only once and only as that built-in; anything else (an
 *   unknown `builtin`, a second claim, a user group named like a built-in) is demoted to a user
 *   group with a fresh id;
 * - an unknown display becomes `submenu`, a label is trimmed to `MAX_GROUP_LABEL`;
 * - an id in `hidden` that is also placed in `nodes` is taken out of `hidden`, and a built-in group
 *   in `removedGroups` that is in `nodes` is taken out of `removedGroups`;
 * - at most `MAX_LAYOUT_NODES` nodes and `MAX_USER_GROUPS` user groups (extra groups are dissolved).
 */

import {
  isContextMenuEntryId,
  isContextMenuGroupId,
  type ContextMenuEntryId,
  type ContextMenuGroupId,
} from './entries'
import {
  APP_DEFAULT_TEMPLATE_ID,
  MAX_GROUP_DEPTH,
  MAX_GROUP_LABEL,
  MAX_LAYOUT_NODES,
  MAX_TEMPLATE_DESCRIPTION,
  MAX_TEMPLATE_NAME,
  MAX_TEMPLATES,
  MAX_USER_GROUPS,
  NO_ORG_KEY,
  type ContextMenuPrefsByOrg,
  type GroupDisplay,
  type LayoutGroupNode,
  type LayoutNode,
  type MenuLayout,
  type OrgContextMenuSettings,
  type OrgMenuTemplate,
  type UserContextMenuPrefs,
} from './types'
import { en as enStrings } from '@/lib/i18n/locales/contextMenuCustomizer/en'

/**
 * A built-in group's English name, for a group demoted from it (a stored label, so it is the
 * English one; the locale dictionary is imported directly because `@/lib/i18n` reads the store).
 */
function builtinGroupName(id: ContextMenuGroupId): string | undefined {
  const names = (enStrings.contextMenuCustomizer as Record<string, unknown>).group as Record<string, string> | undefined
  return names?.[id]
}

/** Raw nesting beyond this is not walked at all (a hostile file, not a layout). */
const MAX_RAW_DEPTH = 16
/** Raw nodes looked at before the rest of an oversized input is ignored. */
const MAX_RAW_VISITS = MAX_LAYOUT_NODES * 10
/** Ids of user groups and templates: short, plain characters. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
/** Icon names: the same shape; unknown names are kept and fall back when drawn (`groupIcon`). */
const SAFE_ICON = /^[A-Za-z0-9_-]{1,32}$/
/** An organization key of `contextMenuPrefs`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_HASH_LENGTH = 64
const MAX_ACTOR_LENGTH = 64
const FALLBACK_TIME = new Date(0).toISOString()
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const DISPLAYS: ReadonlySet<string> = new Set<GroupDisplay>(['submenu', 'inline', 'collapsed', 'auto'])

type RawObject = Record<string, unknown>

function isObject(value: unknown): value is RawObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function own(object: RawObject, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value) && !PROTO_KEYS.has(value)
}

function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim().slice(0, max).trim()
  return text ? text : undefined
}

/** A user group id not yet used: `g-` and random characters. */
export function newUserGroupId(used: ReadonlySet<string>): string {
  for (;;) {
    const id = `g-${Math.random().toString(36).slice(2, 10)}`
    if (!used.has(id) && !isContextMenuGroupId(id)) return id
  }
}

/** Every group id in a layout (any depth). */
export function layoutGroupIds(nodes: readonly LayoutNode[]): Set<string> {
  const ids = new Set<string>()
  const walk = (list: readonly LayoutNode[]) => {
    for (const node of list) {
      if (node.kind === 'group') {
        ids.add(node.id)
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return ids
}

interface SanitizeState {
  entries: Set<ContextMenuEntryId>
  builtins: Set<ContextMenuGroupId>
  groupIds: Set<string>
  /** Raw ids that were kept as given; checked again when a fresh id is drawn. */
  reservedIds: Set<string>
  userGroups: number
  nodes: number
  visits: number
}

function sanitizeNodes(raw: unknown, containerDepth: number, rawDepth: number, state: SanitizeState): LayoutNode[] {
  const out: LayoutNode[] = []
  if (!Array.isArray(raw) || rawDepth > MAX_RAW_DEPTH) return out
  for (const item of raw) {
    if (state.visits++ >= MAX_RAW_VISITS) break
    if (state.nodes >= MAX_LAYOUT_NODES) break
    if (!isObject(item)) continue
    const kind = own(item, 'kind')
    if (kind === 'entry') {
      const id = own(item, 'id')
      if (!isContextMenuEntryId(id) || state.entries.has(id)) continue
      state.entries.add(id)
      state.nodes++
      out.push({ kind: 'entry', id })
    } else if (kind === 'separator') {
      state.nodes++
      out.push({ kind: 'separator' })
    } else if (kind === 'group') {
      const group = sanitizeGroup(item, containerDepth, rawDepth, state)
      if (Array.isArray(group)) out.push(...group)
      else out.push(group)
    }
  }
  return out
}

/** One group, or its children when it has to be dissolved. */
function sanitizeGroup(
  item: RawObject,
  containerDepth: number,
  rawDepth: number,
  state: SanitizeState,
): LayoutGroupNode | LayoutNode[] {
  const depth = containerDepth + 1
  const rawChildren = own(item, 'children')
  if (depth > MAX_GROUP_DEPTH) {
    return sanitizeNodes(rawChildren, containerDepth, rawDepth + 1, state)
  }

  const rawBuiltin = own(item, 'builtin')
  const rawId = own(item, 'id')
  let builtin: ContextMenuGroupId | undefined
  let id: string | undefined
  if (isContextMenuGroupId(rawBuiltin) && !state.builtins.has(rawBuiltin)) {
    builtin = rawBuiltin
    id = rawBuiltin
  } else if (isSafeId(rawId) && !isContextMenuGroupId(rawId) && !state.groupIds.has(rawId)) {
    id = rawId
  }

  if (!builtin) {
    if (state.userGroups >= MAX_USER_GROUPS) {
      return sanitizeNodes(rawChildren, containerDepth, rawDepth + 1, state)
    }
    state.userGroups++
  }
  if (builtin) state.builtins.add(builtin)
  if (!id) id = newUserGroupId(new Set([...state.groupIds, ...state.reservedIds]))
  state.groupIds.add(id)
  state.nodes++

  const rawDisplay = own(item, 'display')
  let display: GroupDisplay =
    typeof rawDisplay === 'string' && DISPLAYS.has(rawDisplay) ? (rawDisplay as GroupDisplay) : 'submenu'
  if (depth > 1 && (display === 'collapsed' || display === 'auto')) display = 'inline'

  const group: LayoutGroupNode = { kind: 'group', id, display, children: [] }
  if (builtin) group.builtin = builtin
  // A group demoted from a built-in claim keeps the built-in's name, so it never shows unnamed.
  const demotedFrom = builtin
    ? undefined
    : isContextMenuGroupId(rawBuiltin)
      ? rawBuiltin
      : isContextMenuGroupId(rawId)
        ? rawId
        : undefined
  const label =
    cleanText(own(item, 'label'), MAX_GROUP_LABEL) ?? (demotedFrom ? builtinGroupName(demotedFrom) : undefined)
  if (label) group.label = label
  const icon = own(item, 'icon')
  if (typeof icon === 'string' && SAFE_ICON.test(icon) && !PROTO_KEYS.has(icon)) group.icon = icon
  group.children = sanitizeNodes(rawChildren, depth, rawDepth + 1, state)
  return group
}

/** Collect the safe raw ids first, so a fresh id never takes one a later group already uses. */
function reservedGroupIds(raw: unknown, rawDepth = 0, out = new Set<string>()): Set<string> {
  if (!Array.isArray(raw) || rawDepth > MAX_RAW_DEPTH || out.size > MAX_RAW_VISITS) return out
  for (const item of raw) {
    if (!isObject(item) || own(item, 'kind') !== 'group') continue
    const id = own(item, 'id')
    if (isSafeId(id)) out.add(id)
    reservedGroupIds(own(item, 'children'), rawDepth + 1, out)
  }
  return out
}

function uniqueEntryIds(raw: unknown, exclude: ReadonlySet<string>): ContextMenuEntryId[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ContextMenuEntryId[] = []
  for (const id of raw.slice(0, MAX_RAW_VISITS)) {
    if (!isContextMenuEntryId(id) || seen.has(id) || exclude.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** A layout from untrusted JSON, or null when it is not a layout at all. */
export function sanitizeLayout(input: unknown): MenuLayout | null {
  if (!isObject(input)) return null
  const version = own(input, 'v')
  if (version !== undefined && version !== 1) return null
  const rawNodes = own(input, 'nodes')
  if (!Array.isArray(rawNodes)) return null

  const state: SanitizeState = {
    entries: new Set(),
    builtins: new Set(),
    groupIds: new Set(),
    reservedIds: reservedGroupIds(rawNodes),
    userGroups: 0,
    nodes: 0,
    visits: 0,
  }
  const nodes = sanitizeNodes(rawNodes, 0, 0, state)
  const hidden = uniqueEntryIds(own(input, 'hidden'), state.entries)

  const removedGroups: ContextMenuGroupId[] = []
  const rawRemoved = own(input, 'removedGroups')
  if (Array.isArray(rawRemoved)) {
    for (const id of rawRemoved.slice(0, MAX_RAW_VISITS)) {
      if (!isContextMenuGroupId(id) || state.builtins.has(id) || removedGroups.includes(id)) continue
      removedGroups.push(id)
    }
  }
  return { v: 1, nodes, hidden, removedGroups }
}

function sanitizeTemplate(input: unknown): OrgMenuTemplate | null {
  if (!isObject(input)) return null
  const id = own(input, 'id')
  if (!isSafeId(id) || id === APP_DEFAULT_TEMPLATE_ID) return null
  const name = cleanText(own(input, 'name'), MAX_TEMPLATE_NAME)
  if (!name) return null
  const layout = sanitizeLayout(own(input, 'layout'))
  if (!layout) return null
  const updatedAt = own(input, 'updated_at')
  const template: OrgMenuTemplate = {
    id,
    name,
    layout,
    updated_at: isIsoTime(updatedAt) ? updatedAt : FALLBACK_TIME,
  }
  const description = cleanText(own(input, 'description'), MAX_TEMPLATE_DESCRIPTION)
  if (description) template.description = description
  const updatedBy = own(input, 'updated_by')
  if (typeof updatedBy === 'string' && updatedBy && updatedBy.length <= MAX_ACTOR_LENGTH) {
    template.updated_by = updatedBy
  }
  return template
}

/**
 * `organization.settings.context_menu` from the database, or null when there is none. Templates
 * that cannot be read are dropped; a default naming a template that is gone is cleared.
 */
export function sanitizeOrgContextMenu(input: unknown): OrgContextMenuSettings | null {
  if (!isObject(input)) return null
  const templates: OrgMenuTemplate[] = []
  const rawTemplates = own(input, 'templates')
  if (Array.isArray(rawTemplates)) {
    for (const raw of rawTemplates.slice(0, MAX_RAW_VISITS)) {
      if (templates.length >= MAX_TEMPLATES) break
      const template = sanitizeTemplate(raw)
      if (template && !templates.some((t) => t.id === template.id)) templates.push(template)
    }
  }
  const settings: OrgContextMenuSettings = { templates }
  const defaultId = own(input, 'default_template_id')
  if (typeof defaultId === 'string' && templates.some((t) => t.id === defaultId)) {
    settings.default_template_id = defaultId
  }
  const forcedAt = own(input, 'forced_at')
  if (isIsoTime(forcedAt)) settings.forced_at = forcedAt
  return settings
}

/** One organization's prefs from untrusted JSON (local storage, an import), or null. */
export function sanitizeUserContextMenuPrefs(input: unknown): UserContextMenuPrefs | null {
  if (!isObject(input)) return null
  const rawTemplateId = own(input, 'templateId')
  const pinned = uniqueEntryIds(own(input, 'pinned'), new Set())
  const prefs: UserContextMenuPrefs = {
    templateId: isSafeId(rawTemplateId) ? rawTemplateId : null,
    pinned,
    // An entry both pinned and hidden stays pinned, as `sanitizeLayout` keeps a placed entry.
    hidden: uniqueEntryIds(own(input, 'hidden'), new Set(pinned)),
    custom: sanitizeLayout(own(input, 'custom')),
  }
  const from = own(input, 'customizedFrom')
  if (isObject(from)) {
    const templateId = own(from, 'templateId')
    const baseHash = own(from, 'baseHash')
    if (isSafeId(templateId) && typeof baseHash === 'string' && baseHash && baseHash.length <= MAX_HASH_LENGTH) {
      prefs.customizedFrom = { templateId, baseHash }
    }
  }
  const updatedAt = own(input, 'updatedAt')
  if (isIsoTime(updatedAt)) prefs.updatedAt = updatedAt
  const kept = own(input, 'keptAfterForce')
  if (isIsoTime(kept)) prefs.keptAfterForce = kept
  return prefs
}

/** A key of `contextMenuPrefs`: an organization id (uuid) or `NO_ORG_KEY`. */
export function isContextMenuPrefsKey(key: unknown): key is string {
  return key === NO_ORG_KEY || (typeof key === 'string' && UUID.test(key))
}

/** `contextMenuPrefs` from local storage; anything unreadable is dropped. */
export function sanitizeContextMenuPrefsByOrg(input: unknown): ContextMenuPrefsByOrg {
  const out: ContextMenuPrefsByOrg = {}
  if (!isObject(input)) return out
  for (const key of Object.keys(input).slice(0, MAX_RAW_VISITS)) {
    if (!isContextMenuPrefsKey(key)) continue
    const prefs = sanitizeUserContextMenuPrefs(input[key])
    if (prefs) out[key] = prefs
  }
  return out
}
