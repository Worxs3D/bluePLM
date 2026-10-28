/**
 * Title, message, completion mode, priority and due date of the package being built.
 */

import { localDateString } from '@/features/source/reviews/lib/queueChips'
import { t } from '@/lib/i18n'
import type { DraftMetaPatch } from '@/stores/slices/reviewsDraft'
import type { ReviewPackageDraft } from '@/types/reviewPackageDraft'
import type { ReviewMode, ReviewPriority } from '@/types/reviews'

const PRIORITIES: ReviewPriority[] = ['low', 'normal', 'high', 'urgent']
const MODES: ReviewMode[] = ['all', 'any']

interface PackageMetaFieldsProps {
  draft: ReviewPackageDraft
  onChange: (patch: DraftMetaPatch) => void
}

const LABEL = 'block text-[11px] font-medium text-plm-fg-muted mb-0.5'
const INPUT =
  'w-full px-2 py-1 text-xs bg-plm-bg-light border border-plm-border rounded focus:outline-none focus:border-plm-accent'

export function PackageMetaFields({ draft, onChange }: PackageMetaFieldsProps) {
  return (
    <div className="space-y-2">
      <div>
        <label className={LABEL} htmlFor="review-package-title">
          {t('reviewBuilder.meta.title')}
        </label>
        <input
          id="review-package-title"
          type="text"
          value={draft.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={t('reviewBuilder.meta.titlePlaceholder')}
          className={INPUT}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="review-package-message">
          {t('reviewBuilder.meta.message')}
        </label>
        <textarea
          id="review-package-message"
          value={draft.message}
          onChange={(e) => onChange({ message: e.target.value })}
          placeholder={t('reviewBuilder.meta.messagePlaceholder')}
          rows={3}
          className={`${INPUT} resize-y`}
        />
      </div>

      <fieldset>
        <legend className={LABEL}>{t('reviewBuilder.meta.mode')}</legend>
        <div className="space-y-1">
          {MODES.map((mode) => (
            <label key={mode} className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="radio"
                name="review-package-mode"
                checked={draft.mode === mode}
                onChange={() => onChange({ mode })}
                className="mt-0.5"
              />
              <span>
                <span className="text-plm-fg">{t(`reviewBuilder.mode.${mode}`)}</span>
                <span className="block text-[10px] text-plm-fg-muted">
                  {t(`reviewBuilder.modeHint.${mode}`)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className={LABEL} htmlFor="review-package-priority">
            {t('reviewBuilder.meta.priority')}
          </label>
          <select
            id="review-package-priority"
            value={draft.priority}
            onChange={(e) => onChange({ priority: e.target.value as ReviewPriority })}
            className={INPUT}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`reviewQueue.priority.${p}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className={LABEL} htmlFor="review-package-due">
            {t('reviewBuilder.meta.dueDate')}
          </label>
          {/* type="date" yields YYYY-MM-DD; it is stored and sent as that string, never a Date */}
          <input
            id="review-package-due"
            type="date"
            value={draft.dueDate ?? ''}
            min={localDateString()}
            onChange={(e) => onChange({ dueDate: e.target.value || null })}
            className={INPUT}
          />
        </div>
      </div>
    </div>
  )
}
