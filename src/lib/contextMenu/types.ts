/**
 * The right-click menu layout: which entries the file and folder menu shows, in what order, in
 * which groups, and which are hidden.
 *
 * A layout names entries by stable id (`ContextMenuEntryId`, from `entries.ts`). It never holds a
 * label, a condition or a handler: the menu still decides, per file, whether an entry applies
 * (an entry that does not apply is skipped, and a group or separator left empty disappears with
 * it). So a layout can only rearrange the menu, never make an action appear where it would not.
 *
 * Layers, first that exists wins (`effectiveLayout` in `effective.ts`):
 *   1. the user's own layout (local, per organization; `contextMenuPrefs` in the settings slice):
 *      a full custom layout, or pins and hidden entries over the template
 *   2. the organization template the user picked
 *   3. the organization's default template (`organization.settings.context_menu`)
 *   4. the app default (`DEFAULT_LAYOUT` in `entries.ts`)
 * Then `completeLayout` adds any entry the layout has never seen (a newer app version) at its
 * default place, so an update never loses an action from a customised menu.
 */

import type { ContextMenuEntryId, ContextMenuGroupId } from './entries'

/** How a group shows in the menu. */
export type GroupDisplay =
  /** One row that opens a flyout with the children. */
  | 'submenu'
  /** The children in the menu itself, set apart by separators, under an optional small heading. */
  | 'inline'
  /** A "More actions" row that expands the children in place. */
  | 'collapsed'
  /** Inline while the menu is short, collapsed once it is longer than `AUTO_COLLAPSE_ROWS`. */
  | 'auto'

export interface LayoutEntryNode {
  kind: 'entry'
  id: ContextMenuEntryId
}

export interface LayoutSeparatorNode {
  kind: 'separator'
}

export interface LayoutGroupNode {
  kind: 'group'
  /** Unique in the layout. A built-in group uses its `ContextMenuGroupId`; a user group `g-<random>`. */
  id: string
  /** Set for the app's own groups (Generate, File actions, ...): its label is translated. */
  builtin?: ContextMenuGroupId
  /** The name a person gave the group. Wins over the built-in label when set. */
  label?: string
  /** A lucide icon name from `GROUP_ICONS`; unknown names fall back to the default. */
  icon?: string
  display: GroupDisplay
  children: LayoutNode[]
}

export type LayoutNode = LayoutEntryNode | LayoutSeparatorNode | LayoutGroupNode

export interface MenuLayout {
  /** Format version. Bump only with a migration in `sanitize.ts`. */
  v: 1
  nodes: LayoutNode[]
  /**
   * Entries the person took out of the menu. Kept apart from "never seen", so `completeLayout`
   * does not bring a hidden entry back while it still adds entries from a newer app version.
   */
  hidden: ContextMenuEntryId[]
  /**
   * Built-in groups the person dissolved or deleted. A built-in group that is neither in `nodes`
   * nor here is one this layout has never seen (a newer app), and `completeLayout` recreates it at
   * its default place.
   */
  removedGroups: ContextMenuGroupId[]
}

/**
 * Groups may nest this deep (top level = 1): Generate > Local. A deeper group's children are
 * lifted into its parent. Only top-level groups may be `collapsed` or `auto`; below the top level
 * they become `inline`.
 */
export const MAX_GROUP_DEPTH = 3
/** A person's group name is cut to this many characters. */
export const MAX_GROUP_LABEL = 40
/** Caps on untrusted layout JSON (organization settings, imports, local storage). */
export const MAX_LAYOUT_NODES = 200
export const MAX_USER_GROUPS = 30
export const MAX_TEMPLATES = 20
export const MAX_TEMPLATE_NAME = 60
export const MAX_TEMPLATE_DESCRIPTION = 200
/**
 * An `auto` group collapses when the menu would otherwise show more rows than this: the resolved
 * top-level rows (entries and group rows, not separators) plus the auto group's own children.
 * 15 is the old `CONTEXT_MENU_ITEMS_THRESHOLD`.
 */
export const AUTO_COLLAPSE_ROWS = 15

/** One template an organization keeps (`organization.settings.context_menu.templates`). */
export interface OrgMenuTemplate {
  id: string
  name: string
  description?: string
  layout: MenuLayout
  /** ISO time of the last save, shown to users and compared with `customizedFrom.updatedAt`. */
  updated_at: string
  updated_by?: string
}

/** `organization.settings.context_menu`. Absent = the app default for everyone. */
export interface OrgContextMenuSettings {
  templates: OrgMenuTemplate[]
  /** The template a user follows until they pick another or customise. Unset = the app default. */
  default_template_id?: string
  /**
   * ISO time an admin last chose "Apply to everyone now". A user's own layout (pins, hidden, full
   * custom) made before this is set aside and they follow their template again (like
   * `module_defaults_forced_at`). The settings page offers to restore it.
   */
  forced_at?: string
}

/** The template id that stands for the app's own default layout. */
export const APP_DEFAULT_TEMPLATE_ID = 'app-default'

/**
 * A user's choice for one organization (local to this computer, like keyboard shortcuts).
 *
 * Two levels, so a small wish does not freeze the whole menu:
 * - quick: `pinned` entries go to the top (in this order, then a separator) and `hidden` entries
 *   leave the menu, both applied over the template, which keeps following the organization;
 * - full: `custom` is the person's whole layout (a snapshot); pins and hidden are folded into it
 *   when they start it, and ignored while it exists.
 */
export interface UserContextMenuPrefs {
  /** The template followed; null = the organization's default. */
  templateId: string | null
  pinned: ContextMenuEntryId[]
  hidden: ContextMenuEntryId[]
  /** The user's own full layout. Null = follow the template live (with pins and hidden). */
  custom: MenuLayout | null
  /**
   * What `custom` started from: the template and a hash of its layout then (`layoutHash`), so the
   * page can say when that template has changed since. App default = `APP_DEFAULT_TEMPLATE_ID`.
   */
  customizedFrom?: { templateId: string; baseHash: string }
  /** ISO time of the last change to pins, hidden or custom (compared with `forced_at`). */
  updatedAt?: string
  /** Set when the person chose to keep their layout after an admin's `forced_at`. */
  keptAfterForce?: string
}

/** `contextMenuPrefs` in the settings slice: organization id (or `NO_ORG_KEY`) -> prefs. */
export type ContextMenuPrefsByOrg = Record<string, UserContextMenuPrefs>
export const NO_ORG_KEY = '_'
