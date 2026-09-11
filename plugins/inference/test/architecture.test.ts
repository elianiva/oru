import { describe, expect, it } from 'vitest'
import { Context, Deferred, Effect, Fiber, Match, Queue, Schema, Stream, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import {
  contribute,
  definePlugin,
  foldActivePlugins,
  makeHost,
  provide,
  SessionLog,
  sessionLogLayer,
  type SessionEvent,
} from '@oru/kernel'
import {
  foldThread,
  Idle,
  Inference,
  inferencePlugin,
  Model,
  TextEvent,
  ToolEvent,
  workOf,
} from '../src/index.ts'
import { ToolKind } from '../src/tool-kind.ts'

const EchoArgs = Schema.Struct({ text: Schema.String })

const echoToolPlugin = definePlugin({
  id: 'tools/echo',
  provides: [
    contribute(ToolKind, {
      name: 'echo',
      description: 'Return the text that was passed in.',
      execute: (argumentsJson) =>
        Effect.try({
          try: () => JSON.parse(argumentsJson),
          catch: () => new Error('invalid tool arguments'),
        }).pipe(
          Effect.flatMap((raw) => Schema.decodeUnknownEffect(EchoArgs)(raw)),
          Effect.map((input) => ({ ok: true, result: JSON.stringify({ echoed: input.text }) })),
          Effect.catch(() => Effect.succeed({ ok: false, result: 'tool failed' })),
        ),
    }),
  ],
})

const threadFacts = (events: readonly SessionEvent[], thread: string): readonly SessionEvent[] =>
  events.filter((event) =>
    Match.value(event).pipe(
      Match.tagsExhaustive({
        'plugin/activated': () => false,
        'plugin/deactivated': () => false,
        'thread/created': (event) => event.thread === thread,
        'turn/started': (event) => event.thread === thread,
        'message/appended': (event) => event.thread === thread,
        'tool/requested': (event) => event.thread === thread,
        'tool/completed': (event) => event.thread === thread,
      }),
    ),
  )

const run = <A, E>(
  effect: Effect.Effect<A, E, EventJournal.EventJournal | SessionLog | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    ),
  )

describe('inference architecture', () => {
  it('streams model chunks into the journal and reconstructs idle thread state from the log', async () => {
    await run(
      Effect.gen(function* () {
        const releaseSecond = yield* Deferred.make<void>()
        const fakeModelPlugin = definePlugin({
          id: 'model/fake',
          provides: [provide(Model)],
          server: {
            setup: () =>
              Effect.succeed(
                Context.make(Model, {
                  streamTurn: (history) => {
                    if (history.some((item) => item._tag === 'tool')) {
                      return Effect.succeed(Stream.succeed(TextEvent.make({ text: 'done' })))
                    }
                    return Effect.succeed(
                      Stream.concat(
                        Stream.succeed(TextEvent.make({ text: 'hello ' })),
                        Stream.fromEffect(
                          Deferred.await(releaseSecond).pipe(
                            Effect.as(TextEvent.make({ text: 'world' })),
                          ),
                        ),
                      ),
                    )
                  },
                }),
              ),
          },
        })

        const host = yield* makeHost([echoToolPlugin, fakeModelPlugin, inferencePlugin])
        const inference = yield* host.service(Inference)
        const log = yield* SessionLog
        const changeQueue = yield* Queue.unbounded<SessionEvent>()
        const liveLog = yield* log.subscribe
        yield* liveLog.pipe(
          Stream.runForEach((event) => Queue.offer(changeQueue, event)),
          Effect.forkScoped,
        )

        const graph = yield* host.graph
        expect([...foldActivePlugins(yield* log.entries)].sort()).toEqual(
          [...graph.active.keys()].sort(),
        )
        expect(graph.active.has('oru/inference')).toBe(true)
        expect(graph.active.has('tools/echo')).toBe(true)
        expect(graph.active.has('model/fake')).toBe(true)

        const sending = yield* inference.send('t1', 'hello').pipe(Effect.forkScoped)

        const firstAssistant = yield* Effect.gen(function* () {
          for (;;) {
            const event = yield* Queue.take(changeQueue)
            if (event._tag === 'message/appended' && event.role === 'assistant') return event
          }
        })
        expect(firstAssistant.body).toBe('hello ')

        const mid = threadFacts(yield* log.entries, 't1')
        expect(
          mid.some((event) => event._tag === 'message/appended' && event.body === 'world'),
        ).toBe(false)

        yield* Deferred.succeed(releaseSecond, undefined)
        yield* Fiber.join(sending)

        const entries = yield* log.entries
        const facts = threadFacts(entries, 't1')
        expect(facts.map((event) => event._tag)).toEqual([
          'message/appended',
          'turn/started',
          'message/appended',
          'message/appended',
        ])
        const bodies: string[] = []
        for (const event of facts) {
          if (event._tag === 'message/appended') bodies.push(`${event.role}:${event.body}`)
        }
        expect(bodies).toEqual(['user:hello', 'assistant:hello ', 'assistant:world'])

        const reconstructed = foldThread(entries, 't1')
        expect(workOf(reconstructed)).toEqual(Idle.make({}))
        expect(workOf(foldThread(entries, 't1'))).toEqual(workOf(reconstructed))
      }),
    )
  })

  it('runs a tool from streamed model output and reconstructs the same idle fold after replay', async () => {
    await run(
      Effect.gen(function* () {
        const fakeModelPlugin = definePlugin({
          id: 'model/fake',
          provides: [provide(Model)],
          server: {
            setup: () =>
              Effect.succeed(
                Context.make(Model, {
                  streamTurn: (history) => {
                    if (history.some((item) => item._tag === 'tool')) {
                      return Effect.succeed(Stream.succeed(TextEvent.make({ text: 'done' })))
                    }
                    return Effect.succeed(
                      Stream.succeed(
                        ToolEvent.make({
                          name: 'echo',
                          call: 'call_1',
                          arguments: JSON.stringify({ text: 'hi' }),
                        }),
                      ),
                    )
                  },
                }),
              ),
          },
        })

        const host = yield* makeHost([echoToolPlugin, fakeModelPlugin, inferencePlugin])
        const inference = yield* host.service(Inference)
        const log = yield* SessionLog
        yield* inference.send('t1', 'hello')

        const entries = yield* log.entries
        const tags = threadFacts(entries, 't1').map((event) => event._tag)
        expect(tags).toEqual([
          'message/appended',
          'turn/started',
          'tool/requested',
          'tool/completed',
          'message/appended',
        ])
        expect(workOf(foldThread(entries, 't1'))).toEqual(Idle.make({}))
        expect(workOf(foldThread([...entries], 't1'))).toEqual(Idle.make({}))
      }),
    )
  })
})
