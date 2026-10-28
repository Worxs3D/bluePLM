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
  return manifest as ExtensionManifest
}
