// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useTranslation } from './index'
import { usePDMStore } from '@/stores/pdmStore'

afterEach(() => {
  cleanup()
  usePDMStore.setState({ language: 'en' })
})

it('keeps the translator stable until the selected language changes', () => {
  const { result, rerender } = renderHook(() => useTranslation())
  const englishTranslator = result.current.t

  rerender()
  expect(result.current.t).toBe(englishTranslator)

  act(() => usePDMStore.getState().setLanguage('de'))
  expect(result.current.t).not.toBe(englishTranslator)
  expect(result.current.t('settings.account')).toBe('Konto')
})
