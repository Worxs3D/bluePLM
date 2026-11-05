/**
 * Official extensions: first-party features that ship inside the app and that an organization
 * installs or uninstalls as a whole (Settings > Extensions). They are not native `.bpx` packages
 * (`src/lib/nativeExtensions/`): a first-party feature runs on the web build, in the tests and in the
 * ui-look harness, and its SQL is part of the numbered migrations. Decision and coupling map:
 * `.cursor/plans/official-extensions.plan.md`.
 *
 * A manifest says what the extension needs, what it works with, which schema objects it owns and what
 * it adds to the app. The install state is `organization.settings.extensions` (see `installed.ts`),
 * written only through `org_extension_set_installed()` (schema 516), which applies the same
 * dependency rules as `dependencies.ts`.
 *
 * Never rename an id: the setting stores it, and the server's list in migration 516 names it.
 */

import type { ModuleId } from '@/types/modules'
import type { SettingsTab } from '@/types/settings'
import type { CommandId } from '@/lib/commands/types'
import type { ContextMenuEntryId } from '@/lib/contextMenu/entries'
import type { ShortcutCategory } from '@/lib/keybindings/registry'
import type { DetailsPanelTab } from '@/stores/types'

export const OFFICIAL_EXTENSION_IDS = ['blueplm.reviews', 'blueplm.inspection', 'blueplm.supply-chain'] as const

export type OfficialExtensionId = (typeof OFFICIAL_EXTENSION_IDS)[number]

/** Core modules an extension can need. Core is always present; listed so the catalog can say so. */
export type CoreFeature = 'explorer' | 'versions' | 'workflows' | 'solidworks'

/** An optional link to another extension: it lights up only when both are installed. */
export interface OfficialExtensionIntegration {
  extension: OfficialExtensionId
  /** `officialExtensions.*` key: what the two do together. */
  what: string
}

export interface OfficialExtensionManifest {
  id: OfficialExtensionId
  /** `officialExtensions.*` keys */
  nameKey: string
  descriptionKey: string
  /** lucide icon name, the same as its sidebar module where it has one */
  icon: string
  /** Hard dependencies: the extension cannot be installed without them. */
  dependencies: {
    core: readonly CoreFeature[]
    extensions: readonly OfficialExtensionId[]
  }
  /** Optional integrations: never required, lit only when both are installed. */
  integrations: readonly OfficialExtensionIntegration[]
  /** Schema objects the extension owns (kept on uninstall; the server refuses writes to the tables). */
  schema: {
    tables: readonly string[]
    /** Owned but not guarded: a retired feature's tables that nothing writes any more (RFQs). */
    retiredTables: readonly string[]
    functions: readonly string[]
  }
  /** What the extension adds. Every gate reads these lists, so an entry here is hidden on uninstall. */
  contributes: {
    modules: readonly ModuleId[]
    settingsTabs: readonly SettingsTab[]
    /** Tabs of the file details panel (bottom, right or popped out) */
    detailsTabs: readonly DetailsPanelTab[]
    contextMenuEntries: readonly ContextMenuEntryId[]
    commands: readonly CommandId[]
    shortcutCategories: readonly ShortcutCategory[]
    /** `officialExtensions.*` keys naming the surfaces in words, for the catalog */
    surfaceKeys: readonly string[]
    /** Hooks into core flows (documentation; each checks the install state itself) */
    hooks: readonly string[]
  }
  /** `officialExtensions.*` keys: what changes for everyone on uninstall beyond the hidden UI. */
  uninstallEffectKeys: readonly string[]
}

export const OFFICIAL_EXTENSIONS: readonly OfficialExtensionManifest[] = [
  {
    id: 'blueplm.reviews',
    nameKey: 'reviewsName',
    descriptionKey: 'reviewsDescription',
    icon: 'ClipboardCheck',
    dependencies: { core: ['explorer', 'versions'], extensions: [] },
    integrations: [],
    schema: {
      tables: [
        'review',
        'review_item',
        'review_round',
        'review_round_item',
        'review_response',
        'review_decision',
      ],
      retiredTables: [],
      functions: ['review_request', 'review_item_respond', 'review_settle', 'review_advance_items'],
    },
    contributes: {
      // Not the Reviews view: it is also where workflow gate approvals (core) are decided, so it
      // stays without the extension and shows only those.
      modules: [],
      settingsTabs: [],
      detailsTabs: [],
      contextMenuEntries: ['reviews'],
      commands: ['download-review-package', 'generate-review-pdfs'],
      shortcutCategories: ['reviews'],
      surfaceKeys: ['reviewsAddsView', 'reviewsAddsMenu', 'reviewsAddsPane', 'reviewsAddsStages'],
      hooks: ['release gate (RELEASE_NOT_REVIEWED)', 'review stages (File workflows)', 'review comments'],
    },
    uninstallEffectKeys: ['reviewsEffectRelease', 'reviewsEffectStages', 'reviewsEffectGates'],
  },
  {
    id: 'blueplm.inspection',
    nameKey: 'inspectionName',
    descriptionKey: 'inspectionDescription',
    icon: 'Ruler',
    dependencies: { core: ['explorer', 'versions', 'solidworks'], extensions: [] },
    integrations: [],
    schema: {
      tables: ['inspection_characteristic', 'inspection_report', 'inspection_template'],
      retiredTables: [],
      functions: ['inspection_report_overwrite', 'inspection_report_pin', 'inspection_template_sync_folder'],
    },
    contributes: {
      modules: [],
      settingsTabs: ['inspection-templates'],
      detailsTabs: ['inspection'],
      contextMenuEntries: ['generate.server.inspectionReport', 'generate.local.inspectionReport'],
      commands: [],
      shortcutCategories: [],
      surfaceKeys: ['inspectionAddsTab', 'inspectionAddsReports', 'inspectionAddsTemplates'],
      hooks: ['working-copy reports at check-in and discard (workingCopyPin.ts)'],
    },
    uninstallEffectKeys: ['inspectionEffectWorkingCopies'],
  },
  {
    id: 'blueplm.supply-chain',
    nameKey: 'supplyChainName',
    descriptionKey: 'supplyChainDescription',
    icon: 'Truck',
    dependencies: { core: ['explorer', 'versions'], extensions: [] },
    integrations: [],
    schema: {
      tables: [
        'supply_order',
        'supply_order_line',
        'supply_order_number_counter',
        'supplier',
        'supplier_contact',
        'supplier_invitation',
        'part_supplier',
      ],
      retiredTables: ['rfq', 'rfq_item', 'rfq_supplier', 'rfq_quote', 'rfq_activity', 'rfq_number_counter'],
      functions: ['supply_order_create', 'supply_order_line_get_outputs'],
    },
    contributes: {
      modules: ['orders', 'supplier-database', 'supplier-portal'],
      settingsTabs: ['orders'],
      detailsTabs: ['vendors', 'orders'],
      contextMenuEntries: ['orders'],
      commands: [],
      shortcutCategories: [],
      surfaceKeys: ['supplyChainAddsView', 'supplyChainAddsMenu', 'supplyChainAddsHistory', 'supplyChainAddsSettings',
        'supplyChainAddsSuppliers', 'supplyChainAddsPortal', 'supplyChainAddsVendors'],
      hooks: [],
    },
    uninstallEffectKeys: [],
  },
]

const BY_ID = new Map<string, OfficialExtensionManifest>(OFFICIAL_EXTENSIONS.map((m) => [m.id, m]))

export function isOfficialExtensionId(id: string): id is OfficialExtensionId {
  return BY_ID.has(id)
}

export function getOfficialExtension(id: OfficialExtensionId): OfficialExtensionManifest {
  const manifest = BY_ID.get(id)
  if (!manifest) throw new Error(`Unknown official extension: ${id}`)
  return manifest
}
