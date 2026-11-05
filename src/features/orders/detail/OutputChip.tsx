/**
 * One output kind an order line sends: "STEP" as a Badge with a glyph for its state (ready,
 * missing, requested, not available, being checked), so the state never rests on colour alone. Status
 * only: which kinds a draft line sends is chosen in the line's outputs menu (`OrderLineRow`).
 */

import { Ban, Check, Clock, Loader2, TriangleAlert } from 'lucide-react'

import { Badge, type BadgeTone } from '@/components/core/ui'
import { useTranslation } from '@/lib/i18n'

import { kindKey } from '../lib/format'
import type { OutputChip as OutputChipModel } from '../lib/outputChips'

const TONE: Record<OutputChipModel['state'], BadgeTone> = {
  ready: 'success',
  missing: 'warning',
  requested: 'info',
  unsupported: 'error',
  checking: 'neutral',
  excluded: 'neutral',
}

function Glyph({ state }: { state: OutputChipModel['state'] }) {
  switch (state) {
    case 'ready':
      return <Check size={12} aria-hidden />
    case 'missing':
      return <TriangleAlert size={12} aria-hidden />
    case 'requested':
      return <Clock size={12} aria-hidden />
    case 'unsupported':
      return <Ban size={12} aria-hidden />
    case 'checking':
      return <Loader2 size={12} className="animate-spin" aria-hidden />
    case 'excluded':
      return null
  }
}

export function OutputChip({ chip }: { chip: OutputChipModel }) {
  const { t } = useTranslation()
  const kind = t(kindKey(chip.kind))
  const state = t(`orders.chip_${chip.state}`, { kind })
  const title = chip.fileName ? `${state} (${chip.fileName})` : state
  return (
    <span title={title} className="inline-flex">
      <Badge tone={TONE[chip.state]} icon={<Glyph state={chip.state} />}>
        {kind}
      </Badge>
      <span className="sr-only">{state}</span>
    </span>
  )
}
