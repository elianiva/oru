import { describe, expect, it } from 'vitest'
import { syncActivePanels } from '../src/active-panels.ts'

describe('syncActivePanels', () => {
  it('adds a consumer panel when its plugin becomes active and drops it when the plugin leaves', () => {
    const create = (id: string) => ({ id })
    const withProvider = syncActivePanels(new Map(), new Set(['logging']), create)
    expect([...withProvider.keys()]).toEqual(['logging'])

    const both = syncActivePanels(withProvider, new Set(['logging', 'greeter']), create)
    expect([...both.keys()].sort()).toEqual(['greeter', 'logging'])
    expect(both.get('logging')).toBe(withProvider.get('logging'))

    const afterProviderGone = syncActivePanels(both, new Set(), create)
    expect(afterProviderGone.size).toBe(0)
  })
})
