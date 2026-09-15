import { describe, expect, it } from 'vitest'
import { Deferred, Effect, Match, Option, Queue, Schema, Stream, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { LanguageModel, turnFromStream } from '@effect-uai/core/LanguageModel'
import * as Items from '@effect-uai/core/Items'
import * as Turn from '@effect-uai/core/Turn'
import {
  definePlugin,
  foldActivePlugins,
  makeHost,
  modelVisiblePath,
  pathOfLane,
  SessionLog,
  sessionLogLayer,
  threadLane,
  type SessionEvent,
} from '@oru/kernel'
import { HarnessKind, HarnessLifecycle, defaultCapabilities, defineHarness } from '@oru/harness'
import { Harnesses } from '@oru/harness'
import { harnessOruPlugin } from '@oru/harness-oru'
import { harnessRegistryPlugin } from '@oru/harness-registry'
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

const harnessesKey = Harnesses.key
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
        'thread/configured': (event) => event.thread === thread,
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
  it('stays blocked until a harness registry names a harness', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([echoToolPlugin, inferencePlugin])
        const graph = yield* host.graph
        expect(graph.active.has('oru/inference')).toBe(false)
        expect(graph.blocked.get('oru/inference')?.missing).toEqual([harnessesKey])
      }),
    )
  })

  it('stays blocked until LanguageModel provides the oru harness', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([echoToolPlugin, harnessOruPlugin, inferencePlugin])
        const graph = yield* host.graph
        expect(graph.active.has('oru/harness-oru')).toBe(false)
        expect(graph.active.has('oru/inference')).toBe(false)
        expect(graph.blocked.get('oru/harness-oru')?.missing).toEqual([languageModelKey])
        expect(graph.blocked.get('oru/inference')?.missing).toEqual([harnessesKey])
      }),
    )
  })

  it('empties the harness registry and blocks the harness plugin when its model is removed', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([
          harnessRegistryPlugin,
          echoToolPlugin,
          demoModelPlugin,
          harnessOruPlugin,
          inferencePlugin,
        ])
        expect((yield* host.graph).active.has('oru/inference')).toBe(true)
        expect((yield* host.graph).active.has('oru/harness-oru')).toBe(true)
        yield* host.deactivate(demoModelPlugin.id)
        const graph = yield* host.graph
        // The registry is what inference depends on, and it is still there: the
        // bridge set changed, not the loop (ADR-0006).
        expect(graph.active.has('oru/inference')).toBe(true)
        expect(graph.active.has('oru/harness-oru')).toBe(false)
        expect(graph.active.has('oru/model-demo')).toBe(false)
        expect(graph.blocked.get('oru/harness-oru')?.missing).toEqual([languageModelKey])
        const registry = yield* host.service(Harnesses)
        expect(yield* registry.list()).toEqual([])
        expect(yield* registry.preferred()).toEqual(Option.none())
      }),
    )
  })

  it('runs the harness a thread chose, and routes its lifecycle operations there', async () => {
    const calls: string[] = []
    const scripted = defineHarness({
      meta: { id: 'scripted', label: 'Scripted' },
      capabilities: { ...defaultCapabilities, tools: false, ownsHistory: true },
      listModels: () => Effect.succeed([{ id: 'scripted/one', label: 'Scripted One' }]),
      streamTurn: (request) =>
        Stream.succeed(
          Turn.TurnEvent.TurnComplete({
            turn: {
              items: [
                Items.assistantText(
                  `answered by ${request.model} with ${request.reasoning ?? 'no'} thinking`,
                ),
              ],
              usage: {},
              stop_reason: 'stop',
            },
          }),
        ),
      stop: () => Effect.sync(() => calls.push('stop')),
      discard: () => Effect.sync(() => calls.push('discard')),
      compact: () =>
        Effect.sync(() => {
          calls.push('compact')
          return { summary: 'kept', tokensBefore: 7, readFiles: [], modifiedFiles: [] }
        }),
      fork: (request) => Effect.sync(() => calls.push(`fork:${request.targetThreadId}`)),
    })
    const scriptedPlugin = definePlugin({
      id: 'oru/harness-scripted',
      provides: [HarnessKind.of(scripted)],
    })

    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([
          harnessRegistryPlugin,
          echoToolPlugin,
          demoModelPlugin,
          harnessOruPlugin,
          scriptedPlugin,
          inferencePlugin,
        ])
        const inference = yield* host.service(Inference)
        const log = yield* SessionLog

        // A thread that never chose runs the registry's default, `oru`.
        yield* inference.send('default', 'hello')
        yield* inference.whenIdle('default')

        yield* inference.configure('chosen', {
          harness: 'scripted',
          model: 'scripted/one',
          reasoning: 'high',
        })
        yield* inference.send('chosen', 'hello')
        yield* inference.whenIdle('chosen')
        const bodies = (yield* log.entries)
          .filter((event) => event._tag === 'message/appended' && event.thread === 'chosen')
          .map((event) => (event._tag === 'message/appended' ? `${event.role}:${event.body}` : ''))
        expect(bodies).toEqual([
          'user:hello',
          'assistant:answered by scripted/one with high thinking',
        ])

        yield* inference.stop('chosen')
        yield* inference.compact('chosen')
        yield* inference.discard('chosen')
        yield* inference.fork({ sourceThreadId: 'chosen', targetThreadId: 'copy' })
        expect(calls).toEqual(['stop', 'compact', 'discard', 'fork:copy'])

        const entries = yield* log.entries
        // The fork is a fact on the new lane: it names the entry it continues
        // from, so a restart reprojects the branch without the bridge copying
        // anything (ADR-0009).
        const branch = entries.find((event) => event._tag === 'thread/branched')
        const sourceLeaf = pathOfLane(entries, threadLane('chosen')).at(-1)
        expect(branch?._tag === 'thread/branched' ? branch.thread : '').toBe('copy')
        expect(branch?._tag === 'thread/branched' ? branch.fromId : '').toBe(sourceLeaf?.id)

        // The compaction the bridge reported is a fact, and the view it keeps is
        // oru's: from the thread's latest request, so a summary replaces what
        // came before it (ADR-0009).
        const compaction = entries.find((event) => event._tag === 'thread/compacted')
        expect(compaction?._tag === 'thread/compacted' ? compaction.summary : '').toBe('kept')
      }),
    )
  })

  it('coalesces streamed text into one journal message after the turn completes', async () => {
    const releaseSecond = Deferred.makeUnsafe<void>()
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([
          harnessRegistryPlugin,
          echoToolPlugin,
          delayedModelPlugin(releaseSecond),
          harnessOruPlugin,
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
        const host = yield* makeHost([
          harnessRegistryPlugin,
          echoToolPlugin,
          demoModelPlugin,
          harnessOruPlugin,
          inferencePlugin,
        ])
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

  it('records the compaction a harness reports during a turn, cut at the request', async () => {
    const compaction = HarnessLifecycle.CompactionEnded({
      automatic: true,
      summary: 'summarised',
      tokensBefore: 40,
      readFiles: [],
      modifiedFiles: [],
    })
    const reporting = defineHarness({
      meta: { id: 'reporting', label: 'Reporting' },
      capabilities: { ...defaultCapabilities, tools: false, ownsHistory: true },
      listModels: () => Effect.succeed([{ id: 'reporting/one', label: 'Reporting One' }]),
      streamTurn: () =>
        Stream.fromIterable([
          compaction,
          Turn.TurnEvent.TurnComplete({
            turn: {
              items: [Items.assistantText('after compaction')],
              usage: {},
              stop_reason: 'stop',
            },
          }),
        ]),
    })
    const reportingPlugin = definePlugin({
      id: 'oru/harness-reporting',
      provides: [HarnessKind.of(reporting)],
    })

    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([
          harnessRegistryPlugin,
          echoToolPlugin,
          reportingPlugin,
          inferencePlugin,
        ])
        const inference = yield* host.service(Inference)
        const log = yield* SessionLog
        yield* inference.configure('t1', { harness: 'reporting' })
        yield* inference.send('t1', 'hello')
        yield* inference.whenIdle('t1')

        const entries = yield* log.entries
        const recorded = entries.find((event) => event._tag === 'thread/compacted')
        const request = pathOfLane(entries, threadLane('t1')).find(
          (event) => event._tag === 'message/appended' && event.role === 'user',
        )
        // The harness supplies the summary; the entry the view keeps from is
        // oru's, taken from the log the same way the requested path takes it.
        expect(recorded?._tag === 'thread/compacted' ? recorded.summary : '').toBe('summarised')
        expect(recorded?._tag === 'thread/compacted' ? recorded.firstKeptEntryId : '').toBe(
          request?.id,
        )
        const visible: string[] = []
        for (const event of modelVisiblePath(entries, 't1')) {
          if (event._tag === 'message/appended') visible.push(`${event.role}:${event.body}`)
        }
        expect(visible).toEqual(['user:hello', 'assistant:after compaction'])
      }),
    )
  })
})
