/**
 * Official extensions strings, English: the source of the key list (`OfficialExtensionsKey`). Every
 * other locale is typed `OfficialExtensionsDict`, so a missing key fails the typecheck.
 */
export const en = {
  // The three extensions
  reviewsName: 'Reviews',
  reviewsDescription: 'Send drawings and models for review, decide per file, and track comments to a decision.',
  reviewsAddsView: 'review packages in the Reviews view',
  reviewsAddsMenu: 'the Reviews submenu of the right-click menu',
  reviewsAddsPane: 'the review pane',
  reviewsAddsStages: 'review stages in file workflows',
  reviewsEffectRelease: 'Drawings release without an approved review.',
  reviewsEffectStages: 'Review stages in file workflows act as plain states.',
  reviewsEffectGates: 'The Reviews view keeps only workflow approvals.',
  inspectionName: 'Inspection',
  inspectionDescription: 'Balloon drawings, keep inspection tables per version and fill Excel inspection reports.',
  inspectionAddsTab: 'the Inspection tab of drawings',
  inspectionAddsReports: 'inspection reports under drawings',
  inspectionAddsTemplates: 'Settings > Inspection templates',
  inspectionEffectWorkingCopies:
    'Reports of a checked-out drawing stay on the old version until Inspection is installed again.',
  supplyChainName: 'Supply chain',
  supplyChainDescription:
    'Suppliers, the supplier portal, and orders of version-pinned PDF, STEP and other outputs for them.',
  supplyChainAddsView: 'the Orders view',
  supplyChainAddsMenu: 'the Orders submenu of the right-click menu',
  supplyChainAddsHistory: '"Add to order" in version history',
  supplyChainAddsSettings: 'Settings > Orders',
  supplyChainAddsSuppliers: 'the Supplier database',
  supplyChainAddsPortal: 'the Supplier portal',
  supplyChainAddsVendors: 'the Vendors tab of files',

  // Core features named under "Needs"
  core_explorer: 'File explorer',
  core_versions: 'Versions',
  core_workflows: 'File workflows',
  core_solidworks: 'SOLIDWORKS',

  // Catalog
  sectionTitle: 'BluePLM extensions',
  sectionIntro:
    'Features built into BluePLM. Installing or uninstalling one changes it for everyone in your organization.',
  sectionIntroMember: 'Only an admin can install or uninstall them.',
  statusInstalled: 'Installed',
  statusNotInstalled: 'Not installed',
  version: 'Version {{version}}',
  adds: 'Adds',
  needs: 'Needs',
  neededBy: 'Needed by',
  worksWith: 'Works with',
  none: 'Nothing',
  install: 'Install',
  uninstall: 'Uninstall',
  listSeparator: ', ',

  // Dialogs
  uninstallTitle: 'Uninstall {{name}}?',
  uninstallBody: '{{name}} disappears for everyone in {{org}}: {{surfaces}}.',
  uninstallKeeps:
    'Nothing is deleted. Its data stays in your database and backups, and installing it again brings everything back.',
  uninstallBlocked: '{{names}} needs {{name}}. Uninstall it first.',
  integrationsDark: 'Stops working with {{names}}.',
  installTitle: 'Install {{name}}?',
  installBody: '{{name}} comes back for everyone in {{org}}: {{surfaces}}.',
  installAlso: 'Also installs {{names}}, which {{name}} needs.',
  integrationsLight: 'Works with {{names}}.',
  yourOrganization: 'your organization',

  // Toasts and errors
  installed: '{{name}} is installed for your organization.',
  uninstalled: '{{name}} is uninstalled. Install it again here at any time.',
  failed: '{{name}} could not be changed: {{message}}',
  notInstalled: '{{name}} is not installed for your organization. An admin can install it in Settings > Extensions.',
  error_NOT_ADMIN: 'Only an admin can install or uninstall extensions.',
  error_UNKNOWN_EXTENSION: 'BluePLM does not know this extension. Update the app or the database.',
  error_DEPENDENCY_INSTALLED: 'Another installed extension needs it.',
  error_DEPENDENCY_MISSING: 'An extension it needs is not installed.',
  error_NEEDS_UPGRADE: 'The database is older than this app. Upgrade it in Settings > Connection first.',
}
