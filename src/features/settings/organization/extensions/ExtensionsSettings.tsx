/**
 * Settings > Extensions: one page for every extension the organization tracks. First the official
 * BluePLM extensions, built into the app (Reviews, Inspection, Orders; also on the web). Then, on the
 * desktop, the native packages an admin installed for the organization (`OrgExtensionsPanel`, `.bpx`
 * files pinned by hash), which need the desktop to inspect and upload a package.
 */
import { Page } from '@/components/core/ui'
import { hasDesktop } from '@/lib/platform'
import { OrgExtensionsPanel } from '@/features/nativeExtensions/OrgExtensionsPanel'

import { OfficialExtensionsSection } from './OfficialExtensionsSection'

export function ExtensionsSettings() {
  return (
    <Page>
      <OfficialExtensionsSection />
      {hasDesktop() && <OrgExtensionsPanel />}
    </Page>
  )
}
