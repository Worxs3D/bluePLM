import { t } from '@/lib/i18n'

import { tokenReference } from './templateModel'

/** Every token a template can hold, with what it does. Token text is literal, never translated. */
export function TemplateTokenReference() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-ui-fg-secondary">{t('source.inspection.tplTokIntro')}</p>
      {tokenReference().map((group) => (
        <div key={group.titleKey}>
          <h4 className="mb-1 text-[13px] font-medium text-ui-fg">{t(group.titleKey)}</h4>
          <table className="w-full text-[12px]">
            <tbody>
              {group.entries.map((entry) => (
                <tr key={entry.token} className="border-t border-ui-divider align-top">
                  <td className="whitespace-nowrap py-1 pr-3 font-mono text-ui-fg">{entry.token}</td>
                  <td className="py-1 text-ui-fg-secondary">
                    {entry.descriptionKey ? t(entry.descriptionKey) : entry.caption}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
