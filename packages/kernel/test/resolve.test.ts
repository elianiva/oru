import { describe, expect, it } from 'vitest'
import { definePlugin, defineService, resolve } from '../src/index'

const A = defineService<{ readonly a: () => void }>('oru/a')

const providerA = definePlugin({
  id: 'provider-a',
})

const consumerB = definePlugin({
  id: 'consumer-b',
  inject: [A],
})

describe('resolve', () => {
  it('keeps registration order and leaves inject-unmet plugins blocked', () => {
    const Missing = defineService<{ readonly ping: () => void }>('oru/missing')
    const lonely = definePlugin({ id: 'lonely', inject: [Missing] })
    const plan = resolve([consumerB, lonely, providerA], new Set())

    expect(plan.order.map((plugin) => plugin.id)).toEqual(['consumer-b', 'lonely', 'provider-a'])
    expect(plan.blocked.get('lonely')?.missing).toEqual(['oru/missing'])
    expect(plan.blocked.get('consumer-b')?.missing).toEqual(['oru/a'])
    expect(plan.blocked.has('provider-a')).toBe(false)
  })

  it('treats baseline services as satisfied', () => {
    const plan = resolve([consumerB], new Set(['oru/a']))
    expect(plan.blocked.has('consumer-b')).toBe(false)
  })

  it('dedupes plugins by id', () => {
    const plan = resolve([providerA, providerA], new Set())
    expect(plan.order.map((plugin) => plugin.id)).toEqual(['provider-a'])
  })
})
