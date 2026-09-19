import { describe, expect, it } from 'vitest'
import { Effect, Fiber, Stream, type Scope } from 'effect'
import { UiClient, clientsFor } from '@oru/rpc'
import { GraphRpc } from '@oru/rpc'
import { UI_SDK_MAJOR } from '@oru/ui'
import { corePlugins, loadExternalPlugins, serveHost } from '../src/index.ts'

/** Run an effect against a freshly listening host with chat-ui built and served. */
const withUiHost = <A, E>(
  effect: Effect.Effect<A, E, GraphRpc | UiClient | Scope.Scope>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const external = yield* loadExternalPlugins([{ specifier: '@oru/chat-ui' }], () => {})
        const running = yield* serveHost({
          plugins: [...corePlugins, ...external],
          hostname: '127.0.0.1',
          port: 0,
          ui: { sources: [{ specifier: '@oru/chat-ui' }] },
        })
        return yield* effect.pipe(Effect.provide(clientsFor(running.url)))
      }),
    ),
  )

describe('the UI snapshot seam', () => {
  it('serves chat-ui bundles and assignments, and empties the slots on deactivate', async () => {
    const seen = await withUiHost(
      Effect.gen(function* () {
        const ui = yield* UiClient
        const graph = yield* GraphRpc
        const first = yield* ui.snapshot()
        yield* graph.setLive('oru/chat-ui', false)
        const empty = yield* ui.snapshot()
        yield* graph.setLive('oru/chat-ui', true)
        const back = yield* ui.snapshot()
        return { first, empty, back }
      }),
    )

    expect(seen.first.assignments).toEqual([
      { slot: 'composer', plugin: 'oru/chat-ui', defId: 'composer' },
      { slot: 'conversation', plugin: 'oru/chat-ui', defId: 'conversation' },
    ])
    expect(seen.first.bundles).toHaveLength(2)
    for (const bundle of seen.first.bundles) {
      expect(bundle.plugin).toBe('oru/chat-ui')
      expect(bundle.address).toMatch(/^[0-9a-f]{64}$/)
      expect(bundle.jsUrl).toBe(`/ui/${bundle.address}.js`)
      expect(bundle.sdkMajor).toBe(UI_SDK_MAJOR)
    }
    expect(seen.empty.assignments).toEqual([])
    expect(seen.empty.bundles).toEqual([])
    expect(seen.back.assignments).toEqual(seen.first.assignments)
  })

  it('serves the built bundle over HTTP', async () => {
    const js = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const external = yield* loadExternalPlugins([{ specifier: '@oru/chat-ui' }], () => {})
          const running = yield* serveHost({
            plugins: [...corePlugins, ...external],
            hostname: '127.0.0.1',
            port: 0,
            ui: { sources: [{ specifier: '@oru/chat-ui' }] },
          })
          const snapshot = yield* Effect.gen(function* () {
            const ui = yield* UiClient
            return yield* ui.snapshot()
          }).pipe(Effect.provide(clientsFor(running.url)))
          const bundle = snapshot.bundles[0]
          if (bundle === undefined) expect.fail('expected a bundle')
          const response = yield* Effect.promise(() => fetch(`${running.url}${bundle.jsUrl}`))
          return yield* Effect.promise(() => response.text())
        }),
      ),
    )
    expect(js).toContain('composer')
  })

  it('streams a snapshot change to a watcher', async () => {
    const seen = await withUiHost(
      Effect.gen(function* () {
        const ui = yield* UiClient
        const graph = yield* GraphRpc
        const watching = yield* ui.watch.pipe(
          Stream.filter((snapshot) => snapshot.assignments.length === 0),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkScoped,
        )
        yield* Effect.sleep('100 millis')
        yield* graph.setLive('oru/chat-ui', false)
        const emptied = yield* Fiber.join(watching)
        return [...emptied].map((snapshot) => snapshot.assignments.length)
      }),
    )
    expect(seen).toEqual([0])
  })
})
