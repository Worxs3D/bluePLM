import { Lock } from 'lucide-react'

import { getModuleIcon } from '@/components/layout/ActivityBar/utils'
import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import { MODULES, type ModuleConfig, type ModuleId } from '@/types/modules'
import type { ExtensionWorkspace } from '@/types/nativeExtensions'

import {
  getExtensionModulePlacement,
  isExtensionModuleEnabled,
  setExtensionModuleEnabled,
  setExtensionModulePlacement,
  type ExtensionModulePlacement,
} from './extensionModules'

function encodePlacement(placement: ExtensionModulePlacement): string {
  return typeof placement === 'string' ? placement : `after:${placement.after}`
}

function decodePlacement(value: string): ExtensionModulePlacement {
  if (value === 'default' || value === 'top') return value
  return { after: value.slice('after:'.length) }
}

/** Entries of the saved order a workspace can follow, with display names. */
function placementAnchors(
  config: ModuleConfig,
  workspaces: readonly ExtensionWorkspace[],
  self: string,
): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = []
  for (const id of config.moduleOrder as readonly string[]) {
    if (id === self) continue
    const name =
      MODULES.find((m) => m.id === id)?.name ?? workspaces.find((w) => w.id === id)?.title
    if (name) out.push({ id, name })
  }
  return out
}

interface ExtensionModulesSectionProps {
  config: ModuleConfig
  onConfigChange: (config: ModuleConfig) => void
  deniedModuleIds?: ReadonlySet<ModuleId>
}

/**
 * Visibility and position of native extension workspaces, below the core
 * sidebar order in every module editor (your own modules, the organization
 * defaults and team defaults). Lists the workspaces loaded in this window. A
 * workspace is placed by its group until a position is chosen here, which
 * saves it in the module order (see placeExtensionModules).
 */
export function ExtensionModulesSection({
  config,
  onConfigChange,
  deniedModuleIds,
}: ExtensionModulesSectionProps) {
  const workspaces = usePDMStore((s) => s.extensionWorkspaces)
  if (workspaces.length === 0) return null

  return (
    <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
      <div className="text-sm text-plm-fg font-medium mb-1">
        {t('nativeExtensions.modulesTitle')}
      </div>
      <p className="text-xs text-plm-fg-muted mb-3">{t('nativeExtensions.modulesDescription')}</p>
      <div className="flex flex-col gap-1">
        {workspaces.map((ws) => {
          const denied = (deniedModuleIds as ReadonlySet<string> | undefined)?.has(ws.id) ?? false
          const enabled = isExtensionModuleEnabled(config, ws.id)
          const placement = getExtensionModulePlacement(config, ws.id)
          const anchors = placementAnchors(config, workspaces, ws.id)
          if (typeof placement !== 'string' && !anchors.some((a) => a.id === placement.after)) {
            anchors.push({ id: placement.after, name: placement.after })
          }
          return (
            <div
              key={ws.id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-plm-bg-secondary border border-plm-border"
            >
              <span className="text-plm-fg-muted">{getModuleIcon(ws.icon, 18)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-plm-fg truncate">{ws.title}</div>
                <div className="text-[10px] text-plm-fg-dim truncate">
                  {t('nativeExtensions.moduleFrom', { extension: ws.extensionId })}
                </div>
              </div>
              {denied && (
                <span
                  className="flex items-center gap-1 text-[10px] px-1 py-0.5 rounded bg-plm-bg-lighter text-plm-fg-dim"
                  title={t('nativeExtensions.moduleRestricted')}
                >
                  <Lock size={9} />
                </span>
              )}
              <select
                value={encodePlacement(placement)}
                onChange={(e) =>
                  onConfigChange(
                    setExtensionModulePlacement(config, ws.id, decodePlacement(e.target.value)),
                  )
                }
                aria-label={t('nativeExtensions.modulePosition', { workspace: ws.title })}
                title={t('nativeExtensions.modulePosition', { workspace: ws.title })}
                className="max-w-[11rem] bg-plm-bg-light border border-plm-border rounded-lg px-2 py-1 text-xs focus:border-plm-accent focus:outline-none"
              >
                <option value="default">{t('nativeExtensions.modulePositionDefault')}</option>
                <option value="top">{t('nativeExtensions.modulePositionTop')}</option>
                {anchors.map((a) => (
                  <option key={a.id} value={`after:${a.id}`}>
                    {t('nativeExtensions.modulePositionAfter', { module: a.name })}
                  </option>
                ))}
              </select>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={ws.title}
                disabled={denied}
                onClick={() => onConfigChange(setExtensionModuleEnabled(config, ws.id, !enabled))}
                title={denied ? t('nativeExtensions.moduleRestricted') : undefined}
                className={`relative w-9 h-5 rounded-full transition-colors ${
                  denied ? 'opacity-40 cursor-not-allowed' : ''
                } ${enabled ? 'bg-plm-success' : 'bg-plm-border'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    enabled ? 'translate-x-4' : ''
                  }`}
                />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
