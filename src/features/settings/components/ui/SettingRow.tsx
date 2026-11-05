import { Row, type RowProps } from '@/components/core/ui'

/**
 * One setting: the shared `Row` (`@/components/core/ui`), marked `data-setting-row` so the
 * settings search can scroll to and flash it (`revealSetting.ts`).
 */
export function SettingRow(props: RowProps) {
  return <Row data-setting-row="" {...props} />
}
