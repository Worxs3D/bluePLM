/**
 * Extension id, version and manifest validation for the main process.
 *
 * The patterns are copied from schemas/extension-v1.schema.json. They are the one
 * check every install path, uninstall and the deep-link handler apply before an id
 * or version reaches the filesystem, a URL or the renderer. An id that passes cannot
 * contain a path separator, `..`, or anything else that changes where a folder
 * named after it lands.
 */

/** `publisher.name`, from the schema's `id` pattern. */
export const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/

/** Semantic version, from the schema's `version` pattern. */
export const EXTENSION_VERSION_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/

/** Longest id accepted. The schema sets no limit; a folder name needs one. */
export const MAX_EXTENSION_ID_LENGTH = 128

/** Longest version accepted. */
export const MAX_EXTENSION_VERSION_LENGTH = 64

export type ExtensionCategory = 'sandboxed' | 'native'

/** Team permission actions, the same five core uses. */
export const PERMISSION_ACTIONS = ['view', 'create', 'edit', 'delete', 'admin'] as const
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number]

/** `contributes.permissions[]`: a team permission resource the extension checks. */
export interface ContributedPermission {
  resource: string
  label: string
  description?: string
  actions: PermissionAction[]
}

/** From the schema's PermissionResourceContribution.resource pattern. */
export const PERMISSION_RESOURCE_PATTERN = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9-]*$/

/** The manifest fields the main process reads. The rest is carried through untouched. */
export interface ExtensionManifest {
  id: string
  name: string
  version: string
  publisher: string
  description?: string
  icon?: string
  repository?: string
  license?: string
  category?: ExtensionCategory
  main?: string
  serverMain?: string
  [key: string]: unknown
}

export function isValidExtensionId(id: unknown): id is string {
  return (
    typeof id === 'string' && id.length <= MAX_EXTENSION_ID_LENGTH && EXTENSION_ID_PATTERN.test(id)
  )
}

export function isValidExtensionVersion(version: unknown): version is string {
  return (
    typeof version === 'string' &&
    version.length <= MAX_EXTENSION_VERSION_LENGTH &&
    EXTENSION_VERSION_PATTERN.test(version)
  )
}

/**
 * The folder an extension is installed in, relative to the extensions directory.
 * Only call with an id that passed `isValidExtensionId`; it throws otherwise.
 */
export function extensionFolderName(id: string): string {
  if (!isValidExtensionId(id)) {
    throw new Error(`Invalid extension id: ${JSON.stringify(id)}`)
  }
  return id.replace(/\./g, '-')
}

/**
 * Parse and validate an `extension.json`. Throws with a message fit to show the
 * user when the JSON is malformed or a required field is missing or invalid.
 */
export function parseExtensionManifest(content: string): ExtensionManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('Invalid extension package: extension.json is not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid extension package: extension.json must be an object')
  }
  const manifest = parsed as Record<string, unknown>

  if (!isValidExtensionId(manifest.id)) {
    throw new Error(
      `Invalid manifest: id ${JSON.stringify(manifest.id)} must match publisher.name (lowercase letters, digits and hyphens)`,
    )
  }
  if (!isValidExtensionVersion(manifest.version)) {
    throw new Error(
      `Invalid manifest: version ${JSON.stringify(manifest.version)} is not a semantic version`,
    )
  }
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    throw new Error('Invalid manifest: name is required')
  }
  if (typeof manifest.publisher !== 'string' || manifest.publisher.length === 0) {
    throw new Error('Invalid manifest: publisher is required')
  }
  if (
    manifest.category !== undefined &&
    manifest.category !== 'sandboxed' &&
    manifest.category !== 'native'
  ) {
    throw new Error(`Invalid manifest: unknown category ${JSON.stringify(manifest.category)}`)
  }
  // Throws on a malformed contributes.permissions.
  getContributedPermissions(manifest)
  return manifest as ExtensionManifest
}

/**
 * The validated `contributes.permissions` of a manifest (empty when absent).
 * Throws when the section is present but malformed.
 */
export function getContributedPermissions(manifest: unknown): ContributedPermission[] {
  if (!manifest || typeof manifest !== 'object') return []
  const contributes = (manifest as { contributes?: unknown }).contributes
  if (!contributes || typeof contributes !== 'object') return []
  const list = (contributes as { permissions?: unknown }).permissions
  if (list === undefined) return []
  if (!Array.isArray(list)) {
    throw new Error('Invalid manifest: contributes.permissions must be an array')
  }
  return list.map((item, index) => {
    const where = `contributes.permissions[${index}]`
    if (!item || typeof item !== 'object') throw new Error(`Invalid manifest: ${where} must be an object`)
    const p = item as Record<string, unknown>
    if (typeof p.resource !== 'string' || !PERMISSION_RESOURCE_PATTERN.test(p.resource)) {
      throw new Error(`Invalid manifest: ${where}.resource must look like 'module:name'`)
    }
    if (typeof p.label !== 'string' || p.label.length === 0) {
      throw new Error(`Invalid manifest: ${where}.label is required`)
    }
    if (p.description !== undefined && typeof p.description !== 'string') {
      throw new Error(`Invalid manifest: ${where}.description must be a string`)
    }
    if (
      !Array.isArray(p.actions) ||
      p.actions.length === 0 ||
      !p.actions.every((a) => (PERMISSION_ACTIONS as readonly unknown[]).includes(a))
    ) {
      throw new Error(`Invalid manifest: ${where}.actions must list view/create/edit/delete/admin`)
    }
    return {
      resource: p.resource,
      label: p.label,
      ...(typeof p.description === 'string' ? { description: p.description } : {}),
      actions: [...new Set(p.actions as PermissionAction[])],
    }
  })
}
