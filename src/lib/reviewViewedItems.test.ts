import { beforeEach, describe, expect, it } from 'vitest'

import {
  forgetViewedItems,
  markItemViewed,
  resetViewedItems,
  viewedItemCount,
} from './reviewViewedItems'

describe('files opened in this session', () => {
  beforeEach(() => resetViewedItems())

  it('stops counting a file once it is decided', () => {
    markItemViewed('r1', 'a')
    markItemViewed('r1', 'b')
    markItemViewed('r1', 'a')
    expect(viewedItemCount('r1')).toBe(2)
    forgetViewedItems('r1', ['a'])
    expect(viewedItemCount('r1')).toBe(1)
    forgetViewedItems('r1', ['b'])
    expect(viewedItemCount('r1')).toBe(0)
  })

  it('starts empty after a reset (sign-out, another organization)', () => {
    markItemViewed('r1', 'a')
    resetViewedItems()
    expect(viewedItemCount('r1')).toBe(0)
  })
})
