import { describe, expect, it } from 'vitest'
import { Effect, Option, Stream, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { definePlugin, makeHost, SessionLog, sessionLogLayer } from '@oru/kernel'
import {
  HarnessKind,
  Harnesses,
  defaultCapabilities,
  defineHarness,
  type HarnessService,
} from '@oru/harness'
import { harnessRegistryPlugin } from '../src/index.ts'

const harness = (id: string, label: string): HarnessService =>
  defineHarness({
    meta: { id, label },
    capabilities: { ...defaultCapabilities, streaming: false },
    listModels: () => Effect.succeed([]),
    streamTurn: () => Stream.empty,
  })

const fake = (pluginId: string, id: string) =>
  definePlugin({
    id: pluginId,
    provides: [HarnessKind.of(harness(id, `${id} bridge`))],
  })

const alpha = fake('oru/harness-alpha', 'alpha')
const beta = fake('oru/harness-beta', 'beta')

const run = <A, E>(
  effect: Effect.Effect<A, E, EventJournal.EventJournal | SessionLog | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    ),
  )

describe('harness registry', () => {
  it('lists every contributed harness, sorted, and answers for one of them', async () => {
    await run(
      Effect.gen(function* () {
        // Two bridges at once: a contribution kind, not a service token.
        const host = yield* makeHost([harnessRegistryPlugin(), beta, alpha])
        const registry = yield* host.service(Harnesses)
        const listed = yield* registry.list()
        expect(listed.map((entry) => entry.plugin)).toEqual([
          'oru/harness-alpha',
          'oru/harness-beta',
        ])
        expect(listed.map((entry) => entry.harness.meta.id)).toEqual(['alpha', 'beta'])

        const alphaEntry = yield* registry.get('alpha')
        expect(Option.isSome(alphaEntry)).toBe(true)
        expect(Option.getOrThrow(alphaEntry).harness.meta.label).toBe('alpha bridge')
        expect(yield* registry.get('nope')).toEqual(Option.none())

        // Deterministic default: the first harness by plugin id, so a thread with
        // no configuration always runs the same bridge.
        expect(Option.getOrThrow(yield* registry.preferred()).harness.meta.id).toBe('alpha')
      }),
    )
  })

  it('prefers the host\u2019s configured default, and falls back when it is not registered', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([harnessRegistryPlugin({ harness: 'beta' }), alpha, beta])
        const registry = yield* host.service(Harnesses)

        // Sorted order would pick alpha; the host's config picks beta.
        expect(Option.getOrThrow(yield* registry.preferred()).harness.meta.id).toBe('beta')
        expect(registry.defaults()).toEqual({ harness: 'beta' })
        expect(Option.getOrThrow(yield* registry.get('beta')).harness.meta.id).toBe('beta')
      }),
    )

    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([harnessRegistryPlugin({ harness: 'gamma' }), alpha, beta])
        const registry = yield* host.service(Harnesses)

        // A configured default no plugin registered is not a dead end.
        expect(Option.getOrThrow(yield* registry.preferred()).harness.meta.id).toBe('alpha')
      }),
    )
  })

  it('changes the answer live when a harness plugin deactivates', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([harnessRegistryPlugin(), alpha, beta])
        const registry = yield* host.service(Harnesses)
        expect((yield* registry.list()).length).toBe(2)

        yield* host.deactivate(alpha.id)
        expect((yield* registry.list()).map((entry) => entry.harness.meta.id)).toEqual(['beta'])
        expect(Option.getOrThrow(yield* registry.preferred()).harness.meta.id).toBe('beta')

        yield* host.activate(alpha)
        expect((yield* registry.list()).map((entry) => entry.harness.meta.id)).toEqual([
          'alpha',
          'beta',
        ])
      }),
    )
  })

  it('provides the token a consumer depends on without naming a harness', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([harnessRegistryPlugin(), alpha])
        const graph = yield* host.graph
        expect(graph.providers.get(Harnesses.key)).toBe('oru/harness-registry')
        expect(graph.providers.has(HarnessKind.id)).toBe(false)
      }),
    )
  })
})
