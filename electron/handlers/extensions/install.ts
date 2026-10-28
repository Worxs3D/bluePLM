/**
 * Install and uninstall of per-machine extension packages.
 *
 * Kept free of Electron imports so it can be unit tested. The IPC layer in
 * handlers.ts supplies the extensions directory and the package bytes.
 */

import * as fs from 'fs'
import * as path from 'path'
import JSZip from 'jszip'

import { extractPackageSafely } from './safeExtract'
import {
  extensionFolderName,
  isValidExtensionId,
  parseExtensionManifest,
  type ExtensionManifest,
} from './validation'

export type ExtensionVerification = 'verified' | 'community' | 'sideloaded'

export interface InstallPackageOptions {
  /** The per-machine extensions directory. */
  extensionsPath: string
  source: 'store' | 'file'
  /** When given, the manifest id must equal it. */
  expectedId?: string
  /** For a sideload, the file it came from (recorded in the metadata). */
  sourcePath?: string
  /** For a store install, the verified SHA-256 of the package. */
  sha256?: string
}

export interface InstalledPackage {
  manifest: ExtensionManifest
  dir: string
  verification: ExtensionVerification
  installedAt: Date
}

/**
 * The folder an extension lives in. Throws for an invalid id, and checks that the
 * folder is a direct child of the extensions directory before anything uses it.
 */
export function extensionInstallDir(extensionsPath: string, extensionId: string): string {
  const root = path.resolve(extensionsPath)
  const dir = path.resolve(root, extensionFolderName(extensionId))
  if (path.dirname(dir) !== root) {
    throw new Error(`Refusing extension folder outside the extensions directory: ${dir}`)
  }
  return dir
}

/**
 * Verify, extract and record a package. The previous version, if any, is replaced
 * only once the new one is fully written.
 */
export async function installPackage(
  data: Uint8Array,
  options: InstallPackageOptions,
): Promise<InstalledPackage> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new Error('Invalid extension package: not a valid zip archive')
  }

  const manifestFile = zip.file('extension.json')
  if (!manifestFile) {
    throw new Error('Invalid extension package: missing extension.json')
  }
  const manifest = parseExtensionManifest(await manifestFile.async('string'))

  if (options.expectedId !== undefined && manifest.id !== options.expectedId) {
    throw new Error(
      `Package id ${manifest.id} does not match the requested extension ${options.expectedId}`,
    )
  }
  if (manifest.category === 'native') {
    throw new Error(
      'Native extensions run with full trust and are installed for the organization by an administrator. They cannot be installed on one machine from the store or from a file.',
    )
  }

  const dir = extensionInstallDir(options.extensionsPath, manifest.id)
  const verification: ExtensionVerification = options.source === 'file' ? 'sideloaded' : 'community'
  const installedAt = new Date()

  await extractPackageSafely(zip, dir, {
    beforeCommit: (stagingDir) => {
      const metadata = {
        installedAt: installedAt.toISOString(),
        version: manifest.version,
        verification,
        source: options.source,
        extensionId: manifest.id,
        ...(options.sha256 ? { sha256: options.sha256 } : {}),
        ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
      }
      fs.writeFileSync(path.join(stagingDir, '.metadata.json'), JSON.stringify(metadata, null, 2))
      if (verification === 'sideloaded') {
        fs.writeFileSync(path.join(stagingDir, '.sideloaded'), '')
      }
    },
  })

  return { manifest, dir, verification, installedAt }
}

/**
 * Delete an installed extension's folder. Returns false when there was nothing to
 * delete. Throws for an invalid id.
 */
export function removeInstalledPackage(extensionsPath: string, extensionId: string): boolean {
  if (!isValidExtensionId(extensionId)) {
    throw new Error(`Invalid extension id: ${JSON.stringify(extensionId)}`)
  }
  const dir = extensionInstallDir(extensionsPath, extensionId)
  if (!fs.existsSync(dir)) return false
  fs.rmSync(dir, { recursive: true, force: true })
  return true
}

/**
 * Read every installed extension from disk. Skips staging and backup folders (they
 * start with '.'), folders without a valid manifest, and folders whose name does
 * not match the manifest id.
 */
export function readInstalledPackages(
  extensionsPath: string,
  onSkip: (folder: string, reason: string) => void = () => {},
): InstalledPackage[] {
  if (!fs.existsSync(extensionsPath)) return []
  const result: InstalledPackage[] = []
  for (const entry of fs.readdirSync(extensionsPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = path.join(extensionsPath, entry.name)
    const manifestPath = path.join(dir, 'extension.json')
    if (!fs.existsSync(manifestPath)) {
      onSkip(entry.name, 'no extension.json')
      continue
    }
    try {
      const manifest = parseExtensionManifest(fs.readFileSync(manifestPath, 'utf-8'))
      if (extensionFolderName(manifest.id) !== entry.name) {
        onSkip(entry.name, `folder does not match manifest id ${manifest.id}`)
        continue
      }
      let verification: ExtensionVerification = 'community'
      let installedAt = new Date(fs.statSync(manifestPath).mtimeMs)
      const metadataPath = path.join(dir, '.metadata.json')
      if (fs.existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as {
            installedAt?: string
            verification?: ExtensionVerification
          }
          if (metadata.installedAt) installedAt = new Date(metadata.installedAt)
          if (metadata.verification === 'community' || metadata.verification === 'sideloaded') {
            verification = metadata.verification
          }
        } catch {
          // Metadata is informational; the manifest is what counts.
        }
      }
      if (fs.existsSync(path.join(dir, '.sideloaded'))) verification = 'sideloaded'
      result.push({ manifest, dir, verification, installedAt })
    } catch (error) {
      onSkip(entry.name, error instanceof Error ? error.message : String(error))
    }
  }
  return result
}
