import { describe, expect, it } from 'vitest'
import { fallbackProviderLabel, providerInfosOf } from '@oru/harness'
import { providerInfoOf, providerInfosOfIds } from '../src/pi/providers.ts'

describe('provider metadata', () => {
  it('curates known providers with a label and an icon key', () => {
    expect(providerInfoOf('deepseek')).toEqual({ id: 'deepseek', label: 'DeepSeek', icon: 'waves' })
    expect(providerInfoOf('github-copilot')).toEqual({
      id: 'github-copilot',
      label: 'Muse',
      icon: 'bot',
    })
  })

  it('names unknown providers honestly, with no glyph to resolve', () => {
    expect(providerInfoOf('my-custom-endpoint')).toEqual({
      id: 'my-custom-endpoint',
      label: 'My Custom Endpoint',
    })
  })

  it('lists each id once, in first-appearance order', () => {
    expect(providerInfosOfIds(['b', 'a', 'b', 'custom-id']).map((info) => info.id)).toEqual([
      'b',
      'a',
      'custom-id',
    ])
  })

  it('falls back to title-cased labels over bare model providers', () => {
    expect(fallbackProviderLabel('github-copilot')).toBe('Github Copilot')
    expect(
      providerInfosOf([
        { provider: 'deepseek' },
        { provider: 'deepseek' },
        {},
        { provider: 'my-endpoint' },
      ]),
    ).toEqual([
      { id: 'deepseek', label: 'Deepseek' },
      { id: 'unknown', label: 'Unknown' },
      { id: 'my-endpoint', label: 'My Endpoint' },
    ])
  })
})
