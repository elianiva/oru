import { describe, expect, it } from 'vitest'
import { Deferred, Effect, Fiber, Layer, Match, Queue, Schema, Stream, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { LanguageModel, turnFromStream } from '@effect-uai/core/LanguageModel'
import * as Items from '@effect-uai/core/Items'
import * as Turn from '@effect-uai/core/Turn'
import {
  contribute,
  definePlugin,
  foldActivePlugins,
  makeHost,
  SessionLog,
  sessionLogLayer,
  type SessionEvent,
} from '@oru/kernel'
import {
  demoModelLayer,
  defineTool,
  foldThread,
  Idle,
  Inference,
  inferencePlugin,
  workOf,
} from '../src/index.ts'
import { ToolKind } from '../src/tool-kind.ts'

const EchoArgs = Schema.Struct({ text: Schema.String })

const echoToolPlugin = definePlugin({
  id: 'tools/echo',
  provides: [
    contribute(
      ToolKind,
      defineTool({
        name: 'echo',
        description: 'Return the text that was passed in.',
        parameters: EchoArgs,
        execute: (input) => Effect.succeed({ echoed: input.text }),
      }),
    ),
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
        'turn/failed': (event) => event.thread === thread,
        'message/appended': (event) => event.thread === thread,
        'tool/requested': (event) => event.thread === thread,
        'tool/completed': (event) => event.thread === thread,
      }),
    ),
  )

const run = <A, E>(
  effect: Effect.Effect<A, E, EventJournal.EventJournal | SessionLog | LanguageModel | Scope.Scope>,
  model = demoModelLayer,
) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(
        Effect.provide(sessionLogLayer),
        Effect.provide(EventJournal.layerMemory),
        Effect.provide(model),
      ),
    ),
  )

const delayedTextLayer = (releaseSecond: Deferred.Deferred<void>) => {
  const streamTurn = () =>
    Stream.concat(
      Stream.succeed(Turn.TurnEvent.TextDelta({ text: 'hello ' })),
      Stream.concat(
        Stream.fromEffect(
          Deferred.await(releaseSecond).pipe(
            Effect.as(Turn.TurnEvent.TextDelta({ text: 'world' })),
          ),
        ),
        Stream.succeed(
          Turn.TurnEvent.TurnComplete({
            turn: {
              items: [Items.assistantText('hello world')],
              usage: {},
              stop_reason: 'stop',
            },
          }),
        ),
      ),
    )
  return Layer.succeed(LanguageModel, {
    streamTurn,
    turn: turnFromStream(streamTurn),
  })
}

describe('inference architecture', () => {
  it('coalesces streamed text into one journal message after the turn completes', async () => {
    const releaseSecond = Deferred.makeUnsafe<void>()
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([echoToolPlugin, inferencePlugin])
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
        expect(graph.active.has('model/fake')).toBe(false)

        const sending = yield* inference.send('t1', 'hello').pipe(Effect.forkScoped)

        yield* Effect.gen(function* () {
          for (;;) {
            const event = yield* Queue.take(changeQueue)
            if (event._tag === 'turn/started') return event
          }
        })
        expect(
          threadFacts(yield* log.entries, 't1').some(
            (event) => event._tag === 'message/appended' && event.role === 'assistant',
          ),
        ).toBe(false)

        yield* Deferred.succeed(releaseSecond, undefined)
        yield* Fiber.join(sending)

        const facts = threadFacts(yield* log.entries, 't1')
        expect(facts.map((event) => event._tag)).toEqual([
          'message/appended',
          'turn/started',
          'message/appended',
        ])
        const bodies: string[] = []
        for (const event of facts) {
          if (event._tag === 'message/appended') bodies.push(`${event.role}:${event.body}`)
        }
        expect(bodies).toEqual(['user:hello', 'assistant:hello world'])
        expect(workOf(foldThread(yield* log.entries, 't1'))).toEqual(Idle.make({}))
      }),
      delayedTextLayer(releaseSecond),
    )
  })

  it('runs a tool from streamed model output and reconstructs the same idle fold after replay', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([echoToolPlugin, inferencePlugin])
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
