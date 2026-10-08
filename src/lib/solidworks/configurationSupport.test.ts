import { describe, expect, it } from 'vitest'

import { canHaveConfigurations } from './configurationSupport'

describe('canHaveConfigurations', () => {
  it('accepts parts and assemblies, in any case and with or without the dot', () => {
    expect(canHaveConfigurations('.sldprt')).toBe(true)
    expect(canHaveConfigurations('.SLDASM')).toBe(true)
    expect(canHaveConfigurations('sldprt')).toBe(true)
  })

  it('refuses drawings, other files and a missing extension', () => {
    expect(canHaveConfigurations('.slddrw')).toBe(false)
    expect(canHaveConfigurations('.SLDDRW')).toBe(false)
    expect(canHaveConfigurations('.pdf')).toBe(false)
    expect(canHaveConfigurations('')).toBe(false)
    expect(canHaveConfigurations(undefined)).toBe(false)
  })
})
