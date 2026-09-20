import { describe, expect, it } from 'vitest'
import { Effect, Option, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { definePlugin, makeHost, SessionLog, sessionLogLayer } from '@oru/kernel'
import {
  WorkspaceKind,
  Workspaces,
  defineWorkspaceProvider,
  type WorkspaceProvider,
} from '@oru/workspace'
import { workspaceRegistryPlugin } from '../src/index.ts'

const provider = (id: string, label: string): WorkspaceProvider =>
  defineWorkspaceProvider({
    meta: { id, label },
    list: (_project, cwd) => Effect.succeed([{ path: cwd, isCurrent: true, provider: id }]),
    provision: (_project, _cwd, path) => Effect.succeed({ path, isCurrent: false, provider: id }),
    remove: (_project, _cwd, path) => Effect.succeed(path),
  })

const fake = (pluginId: string, id: string) =>
  definePlugin({
    id: pluginId,
    apply: (ctx) => ctx.contribute(WorkspaceKind.of(provider(id, `${id} strategy`))),
  })

const alpha = fake('oru/workspace-alpha', 'alpha')
const beta = fake('oru/workspace-beta', 'beta')

const run = <A, E>(
  effect: Effect.Effect<A, E, EventJournal.EventJournal | SessionLog | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    ),
  )

describe('workspace registry', () => {
  it('lists every contributed provider, sorted, and answers for one of them', async () => {
    await run(
      Effect.gen(function* () {
        // Two strategies at once: a contribution kind, not a service token.
        const host = yield* makeHost([workspaceRegistryPlugin, beta, alpha])
        const registry = yield* host.service(Workspaces)
        const listed = yield* registry.list()
        expect(listed.map((entry) => entry.plugin)).toEqual([
          'oru/workspace-alpha',
          'oru/workspace-beta',
        ])
        expect(listed.map((entry) => entry.provider.meta.id)).toEqual(['alpha', 'beta'])

        const alphaEntry = yield* registry.get('alpha')
        expect(Option.isSome(alphaEntry)).toBe(true)
        expect(Option.getOrThrow(alphaEntry).provider.meta.label).toBe('alpha strategy')
        expect(yield* registry.get('nope')).toEqual(Option.none())

        // Deterministic default: the first provider by plugin id, so an unnamed
        // provision always runs the same strategy.
        expect(Option.getOrThrow(yield* registry.preferred()).provider.meta.id).toBe('alpha')
      }),
    )
  })

  it('prefers the host\u2019s configured default, and falls back when it is not registered', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost(
          [workspaceRegistryPlugin, alpha, beta],
          new Map([['oru/workspace-registry', { provider: 'beta' }]]),
        )
        const registry = yield* host.service(Workspaces)

        // Sorted order would pick alpha; the host's config picks beta.
        expect(Option.getOrThrow(yield* registry.preferred()).provider.meta.id).toBe('beta')
        expect(registry.defaults()).toEqual({ provider: 'beta' })
        expect(Option.getOrThrow(yield* registry.get('beta')).provider.meta.id).toBe('beta')
      }),
    )

    await run(
      Effect.gen(function* () {
        const host = yield* makeHost(
          [workspaceRegistryPlugin, alpha, beta],
          new Map([['oru/workspace-registry', { provider: 'gamma' }]]),
        )
        const registry = yield* host.service(Workspaces)

        // A configured default no plugin registered is not a dead end.
        expect(Option.getOrThrow(yield* registry.preferred()).provider.meta.id).toBe('alpha')
      }),
    )
  })

  it('changes the answer live when a provider plugin deactivates', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([workspaceRegistryPlugin, alpha, beta])
        const registry = yield* host.service(Workspaces)
        expect((yield* registry.list()).length).toBe(2)

        yield* host.deactivate(alpha.id)
        expect((yield* registry.list()).map((entry) => entry.provider.meta.id)).toEqual(['beta'])
        expect(Option.getOrThrow(yield* registry.preferred()).provider.meta.id).toBe('beta')

        yield* host.activate(alpha)
        expect((yield* registry.list()).map((entry) => entry.provider.meta.id)).toEqual([
          'alpha',
          'beta',
        ])
      }),
    )
  })
})
