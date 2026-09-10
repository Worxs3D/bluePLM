// src/features/settings/organization/realign/RealignSection.tsx
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { t } from '@/lib/i18n'

import { RealignDialog } from './RealignDialog'

/**
 * The whole "Re-align with server" surface inside `VaultsSettings.tsx` is this one section:
 * a heading, a description, and a button that opens `RealignDialog`. All state, analysis and
 * markup live in this folder on purpose — `VaultsSettings.tsx` is already well past the
 * "should be split" line, so nothing about this feature grows that file beyond one import and
 * one render call.
 */
export function RealignSection() {
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  return (
    <div className="mt-6">
      <h3 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium mb-3">
        {t('realign.section.heading')}
      </h3>
      <div className="p-4 bg-plm-bg rounded-lg border border-plm-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-plm-highlight">
            <RefreshCw size={18} className="text-plm-fg-muted" />
          </div>
          <div>
            <div className="text-base text-plm-fg">{t('realign.section.title')}</div>
            <div className="text-sm text-plm-fg-muted mt-0.5">
              {t('realign.section.description')}
            </div>
          </div>
        </div>
        <button
          onClick={() => setIsDialogOpen(true)}
          className="btn btn-secondary shrink-0"
        >
          {t('realign.section.button')}
        </button>
      </div>

      <RealignDialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} />
    </div>
  )
}
