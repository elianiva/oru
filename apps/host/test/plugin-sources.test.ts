import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { corePlugins } from '../src/plugins.ts'
import {
  defaultPluginSources,
  loadExternalPlugins,
  loadPluginSource,
} from '../src/plugin-sources.ts'

const run = <A>(effect: Effect.Effect<A>): Promise<A> => Effect.runPromise(effect)

describe('an external plugin source', () => {
  it('loads the pi bridge through the generic loader, not a static import', async () => {
    const plugins = await run(loadPluginSource({ specifier: '@oru/harness-pi' }))
    expect(plugins.map((plugin) => plugin.id)).toEqual(['oru/harness-pi'])
  })

  it('loads the Claude Code bridge through the generic loader, not a static import', async () => {
    const plugins = await run(loadPluginSource({ specifier: '@oru/harness-claude-code' }))
    expect(plugins.map((plugin) => plugin.id)).toEqual(['oru/harness-claude-code'])
  })

  it('resolves a missing source to no plugins without throwing', async () => {
    const messages: string[] = []
    const plugins = await run(
      loadPluginSource({ specifier: '@oru/no-such-plugin' }, (message) => messages.push(message)),
    )
    expect(plugins).toEqual([])
    expect(messages).toEqual(['plugin @oru/no-such-plugin not found, running without it'])
  })

  it('loads every source in order and skips the missing ones', async () => {
    const plugins = await run(
      loadExternalPlugins([{ specifier: '@oru/no-such-plugin' }, ...defaultPluginSources], () => {
        // A test has no one to tell about the missing source.
      }),
    )
    expect(plugins.map((plugin) => plugin.id)).toEqual([
      'oru/harness-pi',
      'oru/harness-claude-code',
    ])
  })
})

describe('the host plugin set', () => {
  it('carries the core plugins, and sources resolve the bridge beside them', async () => {
    expect(corePlugins.map((plugin) => plugin.id).sort()).toEqual([
      'greeter',
      'logging',
      'oru/harness-registry',
      'oru/runtime',
      'tools/echo',
    ])

    const withBridges = await run(loadExternalPlugins(defaultPluginSources, () => undefined))
    expect(withBridges.map((plugin) => plugin.id)).toContain('oru/harness-pi')
    expect(withBridges.map((plugin) => plugin.id)).toContain('oru/harness-claude-code')
  })
})
