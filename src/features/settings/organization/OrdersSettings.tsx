/**
 * Settings > Orders (5.13.0): the organization's order number prefix, with a preview of the next
 * number, and the outputs a new line starts with for each kind of line
 * (`organization.settings.orders`, read through `orderSettingsFromOrg`); and, on the desktop,
 * whether this machine generates the outputs other people request (per machine, the output request
 * worker in `src/lib/outputs/requests.ts`). Administrators change the organization settings,
 * which are re-read before each write so a concurrent change to another key is not put back.
 */
import { useEffect, useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'

import { Button, Callout, Switch, TextInput, ToggleGroup } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import {
  DEFAULT_ORDER_NUMBER_PREFIX,
  LINE_CLASS_KINDS,
  MAX_ORDER_NUMBER_PREFIX,
  ORDER_LINE_CLASSES,
  formatOrderNumber,
  normalizeOrderPrefix,
  orderSettingsFromOrg,
  type OrderLineClass,
} from '@/lib/orders/settings'
import { hasDesktop } from '@/lib/platform'
import { supabase } from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'
import type { OrderOutputKind } from '@/types/orders'
import type { OrderOrgSettings } from '@/types/pdm'

import { SettingRow, SettingsGroup, SettingsPage, SettingsSection } from '../components/ui'
import { saveOrderOrgSettings } from './ordersSettingsSave'

/** The settings search labels (`settingsCatalog`) are these English strings; keep them equal. */
const CLASS_LABEL_KEY: Record<OrderLineClass, string> = {
  model_with_drawing: 'orders.settingsKindsModelWithDrawing',
  model: 'orders.settingsKindsModel',
  drawing: 'orders.settingsKindsDrawing',
}

const CLASS_HINT_KEY: Record<OrderLineClass, string> = {
  model_with_drawing: 'orders.settingsKindsModelWithDrawingHint',
  model: 'orders.settingsKindsModelHint',
  drawing: 'orders.settingsKindsDrawingHint',
}

export function OrdersSettings() {
  const organization = usePDMStore((s) => s.organization)
  const setOrganization = usePDMStore((s) => s.setOrganization)
  const addToast = usePDMStore((s) => s.addToast)
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const orders = usePDMStore((s) => s.orders)
  const ordersLoaded = usePDMStore((s) => s.ordersLoaded)
  const loadOrders = usePDMStore((s) => s.loadOrders)
  const workerEnabled = usePDMStore((s) => s.outputRequestWorkerEnabled)
  const setWorkerEnabled = usePDMStore((s) => s.setOutputRequestWorkerEnabled)
  const isAdmin = getEffectiveRole() === 'admin'
  const desktop = hasDesktop()

  const current = orderSettingsFromOrg(organization?.settings)
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const prefix = draft ?? current.numberPrefix
  const dirty = draft !== null && normalizeOrderPrefix(draft) !== current.numberPrefix
  const disabled = !isAdmin || saving

  // The preview counts on from the newest order (the server also goes above every existing one).
  useEffect(() => {
    if (!ordersLoaded) void loadOrders()
  }, [ordersLoaded, loadOrders])
  const nextSequence = useMemo(
    () => (ordersLoaded ? orders.reduce((max, o) => Math.max(max, o.sequence), 0) + 1 : 1),
    [orders, ordersLoaded],
  )
  const preview = formatOrderNumber(prefix, nextSequence)

  const save = async (patch: OrderOrgSettings) => {
    if (!organization || !isAdmin) return
    setSaving(true)
    try {
      // Re-read first so a concurrent change to another key is not overwritten; a failed read
      // aborts the save (ordersSettingsSave.ts).
      const result = await saveOrderOrgSettings(patch, {
        read: () => supabase.from('organization').select('settings').eq('id', organization.id).single(),
        write: (settings) =>
          supabase
            .from('organization')
            .update({ settings: settings as never })
            .eq('id', organization.id)
            .select('settings')
            .single(),
      })
      if (!result.ok) {
        log.error('[OrdersSettings]', 'Saving the Orders settings failed', { reason: result.reason, message: result.message })
        addToast(
          'error',
          result.reason === 'no_row'
            ? t('orders.settingsNoPermission')
            : t('orders.settingsSaveFailed', { error: result.message }),
        )
        return
      }
      setOrganization({ ...organization, settings: result.settings })
      setDraft(null)
      addToast('success', t('orders.settingsSaved'))
    } catch (error) {
      log.error('[OrdersSettings]', 'Saving the Orders settings failed', { error })
      addToast(
        'error',
        t('orders.settingsSaveFailed', { error: error instanceof Error ? error.message : String(error) }),
      )
    } finally {
      setSaving(false)
    }
  }

  const savePrefix = () => {
    if (!dirty) return
    void save({ number_prefix: normalizeOrderPrefix(prefix) })
  }

  const adminNote = isAdmin ? '' : ` ${t('orders.settingsAdminOnly')}`

  return (
    <SettingsPage>
      <SettingsSection
        title={t('orders.settingsNumbersTitle')}
        description={`${t('orders.settingsNumbersIntro')}${adminNote}`}
      >
        <SettingsGroup>
          <SettingRow
            label={t('orders.settingsPrefix')}
            description={t('orders.settingsPrefixHint')}
            htmlFor="orders-number-prefix"
          >
            <div className="flex items-center gap-2">
              <TextInput
                id="orders-number-prefix"
                value={prefix}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_ORDER_NUMBER_PREFIX))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') savePrefix()
                  if (e.key === 'Escape') setDraft(null)
                }}
                disabled={disabled}
                spellCheck={false}
                size="sm"
                className="w-36 font-mono"
              />
              <Button
                variant="ghost"
                size="sm"
                icon={<RotateCcw size={14} />}
                onClick={() => setDraft(DEFAULT_ORDER_NUMBER_PREFIX)}
                disabled={disabled || normalizeOrderPrefix(prefix) === DEFAULT_ORDER_NUMBER_PREFIX}
                title={t('orders.settingsPrefixReset')}
                aria-label={t('orders.settingsPrefixReset')}
              />
              <Button
                variant="primary"
                size="sm"
                onClick={savePrefix}
                disabled={disabled || !dirty}
                loading={saving && dirty}
              >
                {t('orders.settingsSave')}
              </Button>
            </div>
          </SettingRow>
          <SettingRow
            label={t('orders.settingsNextNumber')}
            description={t('orders.settingsNextNumberHint')}
          >
            <span className="font-mono text-[14px] tabular-nums text-ui-fg" title={preview}>
              {preview}
            </span>
          </SettingRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title={t('orders.settingsKindsTitle')}
        description={`${t('orders.settingsKindsIntro')}${adminNote}`}
      >
        <SettingsGroup>
          {ORDER_LINE_CLASSES.map((lineClass) => {
            const kinds = current.defaultKinds[lineClass]
            return (
              <SettingRow key={lineClass} label={t(CLASS_LABEL_KEY[lineClass])} description={t(CLASS_HINT_KEY[lineClass])}>
                <ToggleGroup<OrderOutputKind>
                  size="sm"
                  value={kinds}
                  disabled={disabled}
                  aria-label={t(CLASS_LABEL_KEY[lineClass])}
                  options={LINE_CLASS_KINDS[lineClass].map((kind) => ({ value: kind, label: t(`orders.kind_${kind}`) }))}
                  onChange={(next) => {
                    const defaultKinds: NonNullable<OrderOrgSettings['default_kinds']> = {}
                    defaultKinds[lineClass] = next
                    void save({ default_kinds: defaultKinds })
                  }}
                />
              </SettingRow>
            )
          })}
        </SettingsGroup>
        {ORDER_LINE_CLASSES.some((c) => current.defaultKinds[c].length === 0) && (
          <Callout tone="info" className="mt-3">
            {t('orders.settingsKindsNone')}
          </Callout>
        )}
      </SettingsSection>

      {desktop && (
        <SettingsSection title={t('orders.settingsMachineTitle')} description={t('orders.settingsMachineIntro')}>
          <SettingsGroup>
            <SettingRow
              label={t('orders.settingsWorker')}
              description={t('orders.settingsWorkerHint')}
            >
              <Switch
                checked={workerEnabled}
                onChange={setWorkerEnabled}
                aria-label={t('orders.settingsWorker')}
              />
            </SettingRow>
          </SettingsGroup>
        </SettingsSection>
      )}
    </SettingsPage>
  )
}
