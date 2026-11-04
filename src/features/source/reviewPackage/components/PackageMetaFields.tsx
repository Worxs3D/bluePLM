/**
 * Title, message, who decides, priority and due date of the draft. Stacked for the narrow pane;
 * priority and due date sit label-left, control-right.
 */

import { Row, SegmentedControl, Select, TextArea, TextInput } from '@/components/core/ui'
import { localDateString } from '@/features/source/reviews/lib/queueChips'
import { displayFileName } from '@/hooks/useFileDisplayName'
import { t } from '@/lib/i18n'
import type { DraftMetaPatch } from '@/stores/slices/reviewsDraft'
import type { ReviewPackageDraft } from '@/types/reviewPackageDraft'
import type { ReviewMode, ReviewPriority } from '@/types/reviews'

const PRIORITIES: ReviewPriority[] = ['low', 'normal', 'high', 'urgent']
const MODES: ReviewMode[] = ['all', 'any']

interface PackageMetaFieldsProps {
  draft: ReviewPackageDraft
  onChange: (patch: DraftMetaPatch) => void
  disabled?: boolean
}

export function PackageMetaFields({ draft, onChange, disabled = false }: PackageMetaFieldsProps) {
  return (
    <div>
      <Row density="compact" stacked label={t('reviewBuilder.meta.title')} htmlFor="review-draft-title">
        <TextInput
          id="review-draft-title"
          value={draft.title}
          disabled={disabled}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={
            draft.items[0] ? displayFileName(draft.items[0].fileName) : t('reviewBuilder.meta.titlePlaceholder')
          }
        />
      </Row>
      <Row density="compact" stacked label={t('reviewBuilder.meta.message')} htmlFor="review-draft-message">
        <TextArea
          id="review-draft-message"
          value={draft.message}
          disabled={disabled}
          onChange={(e) => onChange({ message: e.target.value })}
          placeholder={t('reviewBuilder.meta.messagePlaceholder')}
          rows={3}
          className="resize-y"
        />
      </Row>
      <Row
        density="compact"
        stacked
        label={t('reviewBuilder.meta.mode')}
        description={t(`reviewBuilder.modeHint.${draft.mode}`)}
      >
        <SegmentedControl
          size="sm"
          aria-label={t('reviewBuilder.meta.mode')}
          value={draft.mode}
          onChange={(mode) => !disabled && onChange({ mode })}
          options={MODES.map((mode) => ({
            value: mode,
            label: t(`reviewBuilder.mode.${mode}`),
            disabled,
          }))}
        />
      </Row>
      <Row density="compact" label={t('reviewBuilder.meta.priority')} htmlFor="review-draft-priority">
        <Select
          id="review-draft-priority"
          size="sm"
          value={draft.priority}
          disabled={disabled}
          onChange={(e) => onChange({ priority: e.target.value as ReviewPriority })}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`reviewQueue.priority.${p}`)}
            </option>
          ))}
        </Select>
      </Row>
      <Row density="compact" label={t('reviewBuilder.meta.dueDate')} htmlFor="review-draft-due">
        {/* type="date" yields YYYY-MM-DD; it is stored and sent as that string, never a Date */}
        <TextInput
          id="review-draft-due"
          type="date"
          size="sm"
          className="w-36"
          value={draft.dueDate ?? ''}
          min={localDateString()}
          disabled={disabled}
          onChange={(e) => onChange({ dueDate: e.target.value || null })}
        />
      </Row>
    </div>
  )
}
