import { describe, expect, it } from 'vitest'
import { PluginActivated, PluginDeactivated, ProviderRemoved } from '../src/event.ts'
import { Append, decideHostFact, recoverLifecycle, Skip } from '../src/host-lifecycle.ts'
import {
  MessageAppended,
  PluginActivated as SessionActivated,
  PluginDeactivated as SessionDeactivated,
} from '../src/session-event.ts'
import { relink, unsignedTree } from '../src/session-tree.ts'

describe('recoverLifecycle', () => {
  it('desires the catalog when the journal has no plugin facts', () => {
    const known = new Set(['logging', 'greeter'])
    const recovered = recoverLifecycle(
      [
        MessageAppended.make({
          ...unsignedTree,
          id: 'e1',
          thread: 't1',
          role: 'user',
          body: 'hi',
        }),
      ],
      known,
    )
    expect([...recovered.desired].sort()).toEqual(['greeter', 'logging'])
    expect([...recovered.journalActive]).toEqual([])
  })

  it('desires the folded set after a recorded deactivation', () => {
    const recovered = recoverLifecycle(
      [
        SessionActivated.make({
          ...unsignedTree,
          id: 'a1',
          plugin: 'logging',
          scope: 'host',
        }),
        relink(
          SessionActivated.make({
            ...unsignedTree,
            id: 'a2',
            plugin: 'greeter',
            scope: 'host',
          }),
          1,
          'a1',
        ),
        relink(
          SessionDeactivated.make({
            ...unsignedTree,
            id: 'a3',
            plugin: 'greeter',
            scope: 'host',
          }),
          2,
          'a2',
        ),
        relink(
          SessionDeactivated.make({
            ...unsignedTree,
            id: 'a4',
            plugin: 'logging',
            scope: 'host',
          }),
          3,
          'a3',
        ),
      ],
      new Set(['logging', 'greeter']),
    )
    expect([...recovered.desired]).toEqual([])
    expect([...recovered.journalActive]).toEqual([])
  })
})

describe('decideHostFact', () => {
  it('skips a second activation of a journal-active plugin', () => {
    const decision = decideHostFact(
      new Set(['logging']),
      PluginActivated.make({ plugin: 'logging', scope: 'host' }),
    )
    expect(decision._tag).toBe('Skip')
  })

  it('appends activation when the fold does not yet contain the plugin', () => {
    const decision = decideHostFact(
      new Set(),
      PluginActivated.make({ plugin: 'logging', scope: 'host' }),
    )
    expect(decision).toEqual(Append.make({ next: new Set(['logging']) }))
  })

  it('skips provider removal', () => {
    const current = new Set(['logging'])
    const decision = decideHostFact(
      current,
      ProviderRemoved.make({ token: 'oru/logger', plugin: 'logging' }),
    )
    expect(decision).toEqual(Skip.make({ next: current }))
  })

  it('appends deactivation only while the fold still contains the plugin', () => {
    const append = decideHostFact(
      new Set(['logging']),
      PluginDeactivated.make({ plugin: 'logging', scope: 'host' }),
    )
    expect(append._tag).toBe('Append')
    const skip = decideHostFact(
      new Set(),
      PluginDeactivated.make({ plugin: 'logging', scope: 'host' }),
    )
    expect(skip._tag).toBe('Skip')
  })

  it('skips thread-scoped activation facts so the host fold stays host-wide', () => {
    const current = new Set(['logging'])
    const activated = decideHostFact(
      current,
      PluginActivated.make({ plugin: 'thread-tools', scope: 'thread' }),
    )
    expect(activated).toEqual(Skip.make({ next: current }))
    const deactivated = decideHostFact(
      current,
      PluginDeactivated.make({ plugin: 'thread-tools', scope: 'thread' }),
    )
    expect(deactivated).toEqual(Skip.make({ next: current }))
  })
})
