import { describe, expect, it } from 'vitest'
import { Deferred, Effect, Match, Queue, Schema, Stream, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { LanguageModel, turnFromStream } from '@effect-uai/core/LanguageModel'
import * as Items from '@effect-uai/core/Items'
import * as Turn from '@effect-uai/core/Turn'
import {
  definePlugin,
  foldActivePlugins,
  makeHost,
  SessionLog,
  sessionLogLayer,
  type SessionEvent,
} from '@oru/kernel'
import {
  demoModelPlugin,
  defineTool,
  foldThread,
  Idle,
  Inference,
  inferencePlugin,
  modelPlugin,
  workOf,
} from '../src/index.ts'
import { ToolKind } from '../src/tool-kind.ts'

const EchoArgs = Schema.Struct({ text: Schema.String })

const echoToolPlugin = definePlugin({
  id: 'tools/echo',
  provides: [
    ToolKind.of(
      defineTool({
        name: 'echo',
        description: 'Return the text that was passed in.',
        parameters: EchoArgs,
        execute: (input) => Effect.succeed(JSON.stringify({ echoed: input.text })),
      }),
    ),
  ],
})

const languageModelKey = LanguageModel.key

const threadFacts = (events: readonly SessionEvent[], thread: string): readonly SessionEvent[] =>
  events.filter((event) =>
    Match.value(event).pipe(
      Match.tagsExhaustive({
        'plugin/activated': () => false,
        'plugin/deactivated': () => false,
        'thread/created': (event) => event.thread === thread,
        'project/created': () => false,
        'turn/started': (event) => event.thread === thread,
        'turn/failed': (event) => event.thread === thread,
        'message/appended': (event) => event.thread === thread,
        'tool/requested': (event) => event.thread === thread,
        'tool/completed': (event) => event.thread === thread,
        'thread/compacted': (event) => event.thread === thread,
        'thread/branched': (event) => event.thread === thread,
        'agent/inbox/spliced': (event) => event.thread === thread,
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

const delayedModelPlugin = (releaseSecond: Deferred.Deferred<void>) => {
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
  return modelPlugin('oru/model-delayed', {
    streamTurn,
    turn: turnFromStream(streamTurn),
  })
}

describe('inference architecture', () => {
  it('stays blocked until a model plugin provides LanguageModel', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([echoToolPlugin, inferencePlugin])
        const graph = yield* host.graph
        expect(graph.active.has('oru/inference')).toBe(false)
        expect(graph.blocked.get('oru/inference')?.missing).toEqual([languageModelKey])
      }),
    )
  })

  it('deactivates inference when the model plugin is removed', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([echoToolPlugin, demoModelPlugin, inferencePlugin])
        expect((yield* host.graph).active.has('oru/inference')).toBe(true)
        yield* host.deactivate(demoModelPlugin.id)
        const graph = yield* host.graph
        expect(graph.active.has('oru/inference')).toBe(false)
        expect(graph.active.has('oru/model-demo')).toBe(false)
        expect(graph.blocked.get('oru/inference')?.missing).toEqual([languageModelKey])
      }),
    )
  })

  it('coalesces streamed text into one journal message after the turn completes', async () => {
    const releaseSecond = Deferred.makeUnsafe<void>()
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([
          echoToolPlugin,
          delayedModelPlugin(releaseSecond),
          inferencePlugin,
        ])
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
        expect(graph.active.has('oru/model-delayed')).toBe(true)

        yield* inference.send('t1', 'hello')

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
        yield* inference.whenIdle('t1')

        const facts = threadFacts(yield* log.entries, 't1')
        expect(facts.map((event) => event._tag)).toEqual([
          'message/appended',
          'agent/inbox/spliced',
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
    )
  })

  it('runs a tool from streamed model output and reconstructs the same idle fold after replay', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([echoToolPlugin, demoModelPlugin, inferencePlugin])
        const inference = yield* host.service(Inference)
        const log = yield* SessionLog
        yield* inference.send('t1', 'hello')
        yield* inference.whenIdle('t1')

        const entries = yield* log.entries
        const tags = threadFacts(entries, 't1').map((event) => event._tag)
        expect(tags).toEqual([
          'message/appended',
          'agent/inbox/spliced',
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
