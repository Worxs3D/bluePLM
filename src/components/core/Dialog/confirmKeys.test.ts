// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { enterConfirms } from './confirmKeys'

describe('Enter in a confirm dialog', () => {
  const dialog = document.createElement('div')
  const inside = document.createElement('button')
  const textarea = document.createElement('textarea')
  dialog.append(inside, textarea)
  const opener = document.createElement('button')
  document.body.append(dialog, opener)

  it('confirms from the page and from the button that opened the dialog', () => {
    expect(enterConfirms(null, dialog)).toBe(true)
    expect(enterConfirms(document.body, dialog)).toBe(true)
    expect(enterConfirms(opener, dialog)).toBe(true)
  })

  it('leaves Enter to the dialog’s own buttons and to a text area', () => {
    expect(enterConfirms(inside, dialog)).toBe(false)
    expect(enterConfirms(textarea, dialog)).toBe(false)
  })
})
