import { describe, expect, it } from 'vitest'

import { getStoreActionName } from './storeActionName'

describe('getStoreActionName', () => {
  it('names the first frame outside the timing wrapper', () => {
    const stack = [
      'Error',
      '    at timedSet (file:///app/src/stores/pdmStore.ts:152:21)',
      '    at Object.setCheckoutHydrationStatus (file:///app/src/stores/slices/filesSlice.ts:464:5)',
      '    at file:///app/src/hooks/useLoadFiles.ts:2010:30',
    ].join('\n')

    expect(getStoreActionName(stack)).toBe('setCheckoutHydrationStatus')
  })

  it('handles plain and async frames', () => {
    expect(getStoreActionName('Error\n    at timedSet (x:1:1)\n    at setFiles (y:2:2)')).toBe('setFiles')
    expect(
      getStoreActionName('Error\n    at timedSet (x:1:1)\n    at async runLoad (y:2:2)'),
    ).toBe('runLoad')
  })

  it('returns undefined when no frame has a name', () => {
    expect(getStoreActionName(undefined)).toBeUndefined()
    expect(getStoreActionName('Error\n    at file:///app/a.ts:1:1')).toBeUndefined()
  })
})
