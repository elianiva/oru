import { describe, expect, it } from 'vitest'
import { Effect, Fiber, Option, Stream, type Scope } from 'effect'
import { definePlugin } from '@oru/kernel'
import { HarnessKind, Harnesses, defineHarness } from '@oru/harness'
import { GraphRpc, ThreadClient, clientsFor, type Panel } from '@oru/rpc'
import { Inference } from '@oru/inference'
import { corePlugins, echoToolPlugin, loggingPlugin, serveHost } from '../src/index.ts'

const idsOf = (panels: readonly Panel[]): readonly string[] =>
  panels.map((panel) => panel.plugin).sort()

/** Run an effect against a freshly listening host, over the real transport. */
const withHost = <A, E>(
  effect: Effect.Effect<A, E, GraphRpc | ThreadClient | Scope.Scope>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const running = yield* serveHost({ plugins: corePlugins, hostname: '127.0.0.1', port: 0 })
        return yield* effect.pipe(Effect.provide(clientsFor(running.url)))
      }),
    ),
  )

describe('the RPC transport', () => {
  it('serves the host graph: the plugins that carry a panel, and the live tokens', async () => {
    const first = await withHost(
      Effect.gen(function* () {
        const graph = yield* GraphRpc
        return yield* graph.watch.pipe(Stream.take(1), Stream.runHead)
      }),
    )

    const panels = Option.getOrThrow(first).active
    expect(idsOf(panels)).toEqual(['greeter', 'logging'])
    expect(panels.map((panel) => panel.title).sort()).toEqual(['Greet', 'Log'])
    // A plugin that carries no panel is live in the kernel and absent here.
    expect(idsOf(panels)).not.toContain(echoToolPlugin.id)
    expect([...Option.getOrThrow(first).tokens]).toContain(Inference.key)
    expect([...Option.getOrThrow(first).tokens]).toContain(Harnesses.key)
    expect(Option.getOrThrow(first).agent).toBe(true)
  })

  it('takes a consumer out of the graph and back, because its coeffect left', async () => {
    const seen = await withHost(
      Effect.gen(function* () {
        const graph = yield* GraphRpc
        const down = yield* graph.setLive(loggingPlugin.id, false)
        const up = yield* graph.setLive(loggingPlugin.id, true)
        return { down: idsOf(down.active), tokens: [...down.tokens], up: idsOf(up.active) }
      }),
    )

    expect(seen.down).toEqual([])
    expect(seen.tokens).not.toContain('oru/logger')
    expect(seen.tokens).not.toContain('oru/greeter')
    expect(seen.up).toEqual(['greeter', 'logging'])
  })

  it('streams a graph change to a watcher', async () => {
    const seen = await withHost(
      Effect.gen(function* () {
        const graph = yield* GraphRpc
        const watching = yield* graph.watch.pipe(
          Stream.filter((graph) => graph.active.length === 0),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkScoped,
        )
        // `WatchGraph` subscribes to the host's events after it has emitted its
        // snapshot, and a subscription now crosses the transport, so the change
        // waits a beat instead of racing the subscription.
        yield* Effect.sleep('100 millis')
        yield* graph.setLive(loggingPlugin.id, false)
        return yield* Fiber.join(watching)
      }),
    )

    expect(seen[0]?.active).toEqual([])
  })

  it('carries a turn: the thread, its facts, and its live signals', async () => {
    const turn = await withHost(
      Effect.gen(function* () {
        const thread = yield* ThreadClient
        const created = yield* thread.create(process.cwd())
        const facts = yield* thread
          .watch(created.threadId)
          .pipe(Stream.take(7), Stream.runCollect, Effect.forkScoped)
        const signals = yield* thread.watchSignals(created.threadId).pipe(
          Stream.takeUntil((signal) => signal._tag === 'settled'),
          Stream.runCollect,
          Effect.forkScoped,
        )
        // Live signals have no snapshot to replay, so the subscription has to
        // exist before the turn starts.
        yield* Effect.sleep('100 millis')
        yield* thread.send(created.threadId, 'hello')
        return {
          facts: (yield* Fiber.join(facts)).map((event) => event._tag),
          signals: [...(yield* Fiber.join(signals))].map((signal) => signal._tag),
        }
      }),
    )

    expect(turn.facts).toEqual([
      'thread/created',
      'message/appended',
      'agent/inbox/spliced',
      'turn/started',
      'tool/requested',
      'tool/completed',
      'message/appended',
    ])
    expect(turn.signals).toContain('tool-start')
    expect(turn.signals.at(-1)).toBe('settled')
  })

  it('answers with the harnesses this host has and the catalogue of the default', async () => {
    const options = await withHost(
      Effect.gen(function* () {
        const thread = yield* ThreadClient
        const created = yield* thread.create(process.cwd())
        return yield* thread.options(created.threadId)
      }),
    )

    expect(options.harnesses.map((choice) => choice.id)).toEqual(['oru'])
    expect(options.config).toEqual({
      harness: undefined,
      model: undefined,
      reasoning: undefined,
    })
    expect(options.models.map((model) => model.id)).toContain('mock')
  })

  it('re-probes harness health when ThreadOptions refresh is set', async () => {
    let invalidations = 0
    const sick = defineHarness({
      meta: { id: 'sick', label: 'Sick' },
      health: () =>
        Effect.succeed({
          status: 'not_installed',
          message: 'pi is not on PATH',
          installCommand: 'npm install -g @earendil-works/pi-coding-agent@latest',
        }),
      invalidateHealth: () =>
        Effect.sync(() => {
          invalidations += 1
        }),
      streamTurn: () => Stream.empty,
    })
    const sickPlugin = definePlugin({
      id: 'oru/harness-sick',
      provides: [HarnessKind.of(sick)],
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const running = yield* serveHost({
            plugins: [...corePlugins, sickPlugin],
            hostname: '127.0.0.1',
            port: 0,
          })
          return yield* Effect.gen(function* () {
            const thread = yield* ThreadClient
            const created = yield* thread.create(process.cwd())
            const first = yield* thread.options(created.threadId)
            expect(invalidations).toBe(0)
            expect(
              first.harnesses.find((choice) => choice.id === 'sick')?.health.installCommand,
            ).toBe('npm install -g @earendil-works/pi-coding-agent@latest')
            yield* thread.options(created.threadId, { refresh: true })
            expect(invalidations).toBe(1)
          }).pipe(Effect.provide(clientsFor(running.url)))
        }),
      ),
    )
  })
})
