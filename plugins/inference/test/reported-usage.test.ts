import { describe, expect, it } from 'vitest'
import { decodeReportedUsage, recordedUsageOf } from '../src/reported-usage.ts'

const recorded = (usage: Parameters<typeof recordedUsageOf>[0]) => recordedUsageOf(usage)

describe('recordedUsageOf', () => {
  it('skips an empty usage bag', () => {
    expect(recorded({})).toBeUndefined()
  })

  it('reads token counts and a numeric cost', () => {
    expect(recorded({ input_tokens: 11, output_tokens: 3, cost: 0.04 })).toEqual({
      inputTokens: 11,
      outputTokens: 3,
      cost: 0.04,
    })
  })

  it('reads pi-shaped cost.total', () => {
    expect(recorded({ input_tokens: 12, output_tokens: 5, cost: { total: 0.01 } })).toEqual({
      inputTokens: 12,
      outputTokens: 5,
      cost: 0.01,
    })
  })

  it('rejects a bag the schema cannot read', () => {
    expect(decodeReportedUsage('nope')._tag).toBe('None')
  })
})
