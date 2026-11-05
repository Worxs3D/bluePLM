import { isValidElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { getTranslation } from '@/lib/i18n'
import { emphasizeColumnLabel } from './MetadataColumnDialogs'

function strongText(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(strongText)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [
    ...(node.type === 'strong' ? [String(node.props.children)] : []),
    ...strongText(node.props.children),
  ]
}

describe('metadata column delete confirmation', () => {
  it.each([
    ['en', 'Serial number'],
    ['de', 'Seriennummer'],
  ] as const)('emphasizes the column name in %s', (language, label) => {
    const confirmation = getTranslation(language, 'settingsPages.metadata.deleteConfirm', {
      label,
    })
    expect(strongText(emphasizeColumnLabel(confirmation, label))).toEqual([label])
  })
})
