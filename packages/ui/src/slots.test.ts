import { describe, expect, it } from 'vitest'
import { resolveUiAssignments, type UiClaim } from './slots.ts'

const claim = (plugin: string, slot: 'composer' | 'composerChipsLeft', defId: string): UiClaim => ({
  plugin,
  def: { slot, defId },
})

describe('resolveUiAssignments', () => {
  it('renders an exclusive slot from its single claim', () => {
    expect(resolveUiAssignments([claim('oru/chat-ui', 'composer', 'composer')], {})).toEqual([
      { slot: 'composer', plugin: 'oru/chat-ui', defId: 'composer' },
    ])
  })

  it('renders every additive claim in deterministic order', () => {
    const claims = [
      claim('oru/b', 'composerChipsLeft', 'b'),
      claim('oru/a', 'composerChipsLeft', 'a'),
    ]
    expect(resolveUiAssignments(claims, {})).toEqual([
      { slot: 'composerChipsLeft', plugin: 'oru/a', defId: 'a' },
      { slot: 'composerChipsLeft', plugin: 'oru/b', defId: 'b' },
    ])
  })

  it('keeps the first exclusive claim and warns loud on duplicates', () => {
    const warnings: string[] = []
    const assignments = resolveUiAssignments(
      [claim('oru/b', 'composer', 'composer'), claim('oru/a', 'composer', 'composer')],
      {},
      (message) => warnings.push(message),
    )
    expect(assignments).toEqual([{ slot: 'composer', plugin: 'oru/a', defId: 'composer' }])
    expect(warnings).toHaveLength(1)
  })

  it('pins the override when it names a claim', () => {
    const assignments = resolveUiAssignments(
      [claim('oru/a', 'composer', 'composer'), claim('oru/b', 'composer', 'alt')],
      { composer: 'oru/b/alt' },
      () => {},
    )
    expect(assignments).toEqual([{ slot: 'composer', plugin: 'oru/b', defId: 'alt' }])
  })
})
