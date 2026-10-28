import { t } from '@/lib/i18n'

/**
 * Ask the user where to save a review package. Uses `dialog:select-directory`, which returns the
 * path only (`selectFolder` walks every file in the chosen folder, built for "add folder").
 * Null when cancelled or outside the desktop app.
 */
export async function chooseReviewPackageDestination(defaultPath?: string): Promise<string | null> {
  const api = window.electronAPI
  if (!api?.selectDirectory) return null
  const result = await api.selectDirectory(t('reviewPackage.selectFolderTitle'), defaultPath)
  return result.success && result.path ? result.path : null
}
