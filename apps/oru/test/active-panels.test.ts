import { describe, expect, it } from 'vitest'
import { HashMap } from 'effect'
import { syncActivePanels } from '../src/active-panels.ts'

describe('syncActivePanels', () => {
  it('adds a consumer panel when its plugin becomes active and drops it when the plugin leaves', () => {
    const create = (id: string) => ({ id })
    const withProvider = syncActivePanels(HashMap.empty(), new Set(['logging']), create)
    expect([...HashMap.keys(withProvider)]).toEqual(['logging'])

    const both = syncActivePanels(withProvider, new Set(['logging', 'greeter']), create)
    expect([...HashMap.keys(both)].sort()).toEqual(['greeter', 'logging'])
    expect(HashMap.getUnsafe(both, 'logging')).toBe(HashMap.getUnsafe(withProvider, 'logging'))

    const afterProviderGone = syncActivePanels(both, new Set(), create)
    expect(HashMap.size(afterProviderGone)).toBe(0)
  })

  it('keeps the same child when a graph update still lists the plugin', () => {
    const logging = { id: 'logging' }
    const greeter = { id: 'greeter' }
    const current = HashMap.fromIterable([
      ['logging', logging],
      ['greeter', greeter],
    ])
    const next = syncActivePanels(current, new Set(['logging', 'greeter']), (id) => {
      throw new Error(`must not create ${id}`)
    })
    expect(HashMap.getUnsafe(next, 'logging')).toBe(logging)
    expect(HashMap.getUnsafe(next, 'greeter')).toBe(greeter)
  })
})
