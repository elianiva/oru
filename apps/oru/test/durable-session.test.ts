import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Deferred, Effect, Fiber, Option, Ref, Schema, Stream, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { RpcTest } from 'effect/unstable/rpc'
import {
  definePlugin,
  foldActivePlugins,
  makeHost,
  modelVisiblePath,
  pathOfLane,
  SessionLog,
  sessionLogLayer,
  threadLane,
  type AnyPlugin,
  type SessionEvent,
  type SessionLogContract,
} from '@oru/kernel'
import { sqliteJournalLayer } from '@oru/kernel/sqlite'
import { HarnessKind, defaultCapabilities, defineHarness } from '@oru/harness'
import { harnessOruPlugin } from '@oru/harness-oru'
import { harnessRegistryPlugin } from '@oru/harness-registry'
import {
  defineTool,
  demoModelPlugin,
  foldThread,
  Idle,
  Inference,
  inferencePlugin,
  ToolKind,
  workOf,
  type Work,
} from '@oru/inference'
import { ThreadRpc, threadRpcHandlers } from '../src/thread-rpc.ts'

const EchoArgs = Schema.Struct({ text: Schema.String })

/**
 * The echo the demo model calls, waiting on a gate the test owns. A turn is then
 * genuinely in flight while the host that started it dies. `started` says the
 * runtime reached the tool, and `calls` counts how often it did.
 */
const echoToolPlugin = (
  gate: Deferred.Deferred<void>,
  started: Deferred.Deferred<void>,
  calls: Ref.Ref<number>,
) =>
  definePlugin({
    id: 'tools/echo',
    provides: [
      ToolKind.of(
        defineTool({
          name: 'echo',
          description: 'Return the text that was passed in.',
          parameters: EchoArgs,
          execute: (input) =>
            Ref.updateAndGet(calls, (count) => count + 1).pipe(
              Effect.andThen(Deferred.succeed(started, undefined)),
              Effect.andThen(Deferred.await(gate)),
              Effect.as(JSON.stringify({ echoed: input.text })),
            ),
        }),
      ),
    ],
  })

/**
 * A bridge that can compact and cannot run a turn. A thread is configured to it
 * once its conversation exists, because the summary is the model's work while
 * the cut is the log's.
 */
const compactingHarnessPlugin = definePlugin({
  id: 'oru/harness-compacting',
  provides: [
    HarnessKind.of(
      defineHarness({
        meta: { id: 'compacting', label: 'Compacting' },
        capabilities: { ...defaultCapabilities, tools: false, ownsHistory: true },
        streamTurn: () => Stream.empty,
        compact: () =>
          Effect.succeed({
            summary: 'summarized',
            tokensBefore: 12,
            readFiles: [],
            modifiedFiles: [],
          }),
      }),
    ),
  ],
})

/**
 * The loop is declared before the bridge and the tool it uses, so install order
 * alone would run a resumed lane against a half-built graph. Activation follows
 * declared needs and a boot step runs after the whole graph is up, which is what
 * makes the lane's facts right (ADR-0009).
 */
const pluginsFor = (echo: AnyPlugin, extra: readonly AnyPlugin[] = []) => [
  harnessRegistryPlugin,
  inferencePlugin,
  echo,
  demoModelPlugin,
  harnessOruPlugin,
  ...extra,
]

/** One database file per case, so a second host opens what the first left. */
const sessionFile = (): string => join(mkdtempSync(join(tmpdir(), 'oru-durable-')), 'session.db')

/** One host instance against a database file. The scope closing is the kill. */
const instance = <A, E>(
  file: string,
  effect: Effect.Effect<A, E, SessionLog | EventJournal.EventJournal | Scope.Scope>,
) =>
  Effect.scoped(
    effect.pipe(Effect.provide(sessionLogLayer), Effect.provide(sqliteJournalLayer(file))),
  )

const connect = (plugins: readonly AnyPlugin[]) =>
  Effect.gen(function* () {
    const host = yield* makeHost(plugins)
    const client = yield* RpcTest.makeClient(ThreadRpc).pipe(
      Effect.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
    )
    return { host, client }
  })

/** An open gate: the tool answers as soon as it is called. */
const openGate = () => Deferred.makeUnsafe<void>()

/** Watch for one fact, so a test can act on a lane that is mid-turn. */
const watcherFor = (log: SessionLogContract, predicate: (event: SessionEvent) => boolean) =>
  Effect.gen(function* () {
    const live = yield* log.subscribe
    return yield* live.pipe(
      Stream.filter(predicate),
      Stream.take(1),
      Stream.runHead,
      Effect.forkScoped,
    )
  })

const activationFacts = (entries: readonly SessionEvent[]): readonly string[] => {
  const facts: string[] = []
  for (const event of entries) {
    if (event._tag === 'plugin/activated' || event._tag === 'plugin/deactivated') {
      facts.push(`${event._tag}:${event.plugin}`)
    }
  }
  return facts
}

const tagsOf = (events: readonly SessionEvent[]): readonly string[] =>
  events.map((event) => event._tag)

const bodiesOf = (events: readonly SessionEvent[]): readonly string[] => {
  const bodies: string[] = []
  for (const event of events) {
    if (event._tag === 'message/appended') bodies.push(`${event.role}:${event.body}`)
  }
  return bodies
}

const laneOf = (entries: readonly SessionEvent[], thread: string) =>
  pathOfLane(entries, threadLane(thread))

describe('durable sessions across two hosts', () => {
  it('reconstructs the plugin graph from the facts the previous host wrote', async () => {
    const file = sessionFile()
    await Effect.runPromise(
      Effect.gen(function* () {
        const plugins = pluginsFor(echoToolPlugin(openGate(), openGate(), yield* Ref.make(0)))
        let live: readonly string[] = []
        let recorded: readonly string[] = []

        yield* instance(
          file,
          Effect.gen(function* () {
            const { host } = yield* connect(plugins)
            const log = yield* SessionLog
            yield* host.deactivate(harnessOruPlugin.id)
            live = [...(yield* host.graph).active.keys()].sort()
            recorded = activationFacts(yield* log.entries)
            expect(live).toEqual([
              'oru/harness-registry',
              'oru/inference',
              'oru/model-demo',
              'tools/echo',
            ])
            expect(recorded).toContain(`plugin/deactivated:${harnessOruPlugin.id}`)
          }),
        )

        yield* instance(
          file,
          Effect.gen(function* () {
            const { host } = yield* connect(plugins)
            const entries = yield* (yield* SessionLog).entries
            // The graph comes back from the journal rather than from a fresh
            // boot: the deactivation still holds, and replaying it appends
            // nothing.
            expect([...(yield* host.graph).active.keys()].sort()).toEqual(live)
            expect([...foldActivePlugins(entries)].sort()).toEqual(live)
            expect(activationFacts(entries)).toEqual(recorded)
          }),
        )
      }),
    )
  })

  it('resumes the turn a killed host left in flight', async () => {
    const file = sessionFile()
    await Effect.runPromise(
      Effect.gen(function* () {
        const gate = Deferred.makeUnsafe<void>()
        const started = Deferred.makeUnsafe<void>()
        const calls = yield* Ref.make(0)
        const plugins = pluginsFor(echoToolPlugin(gate, started, calls))
        let thread = ''
        let pending: Work = Idle.make({})

        yield* instance(
          file,
          Effect.gen(function* () {
            const { client } = yield* connect(plugins)
            const log = yield* SessionLog
            const created = yield* client.CreateThread({ cwd: '/tmp' })
            thread = created.threadId
            const requested = yield* watcherFor(
              log,
              (event) => event._tag === 'tool/requested' && event.thread === thread,
            )
            yield* client.SendMessage({ threadId: thread, text: 'hello' })
            const seen = yield* Fiber.join(requested)
            expect(Option.isSome(seen)).toBe(true)
            // The tool the demo model asked for cannot finish, so the kill lands
            // mid-turn with a request and no result.
            yield* Deferred.await(started)
            expect(yield* Ref.get(calls)).toBe(1)
            pending = workOf(foldThread(yield* log.entries, thread))
            expect(pending._tag).toBe('RunTool')
          }),
        )

        yield* instance(
          file,
          Effect.gen(function* () {
            const { host } = yield* connect(plugins)
            const log = yield* SessionLog
            // Opening the journal resumed the lane: the state it derives is the
            // state the kill left, and the bridge is already running the tool
            // again, so the log has not moved.
            expect(workOf(foldThread(yield* log.entries, thread))).toEqual(pending)
            yield* Deferred.succeed(gate, undefined)
            yield* (yield* host.service(Inference)).whenIdle(thread)
            const entries = yield* log.entries
            // At least once: the request that outlived its host ran again.
            expect(yield* Ref.get(calls)).toBe(2)
            expect(tagsOf(laneOf(entries, thread))).toEqual([
              'thread/created',
              'message/appended',
              'agent/inbox/spliced',
              'turn/started',
              'tool/requested',
              'tool/completed',
              'tool/requested',
            ])
            expect(workOf(foldThread(entries, thread))).toEqual(Idle.make({}))
          }),
        )
      }),
    )
  })

  it('adds a lane that reaches back to a thread created before the restart', async () => {
    const file = sessionFile()
    await Effect.runPromise(
      Effect.gen(function* () {
        const gate = openGate()
        yield* Deferred.succeed(gate, undefined)
        const plugins = pluginsFor(echoToolPlugin(gate, openGate(), yield* Ref.make(0)))
        let thread = ''
        let fork = ''

        yield* instance(
          file,
          Effect.gen(function* () {
            const { host, client } = yield* connect(plugins)
            const created = yield* client.CreateThread({ cwd: '/tmp' })
            thread = created.threadId
            const answered = yield* watcherFor(
              yield* SessionLog,
              (event) =>
                event._tag === 'message/appended' &&
                event.thread === thread &&
                event.role === 'assistant',
            )
            yield* client.SendMessage({ threadId: thread, text: 'first request' })
            yield* Fiber.join(answered)
            yield* (yield* host.service(Inference)).whenIdle(thread)
          }),
        )

        yield* instance(
          file,
          Effect.gen(function* () {
            const { client } = yield* connect(plugins)
            const forked = yield* client.ForkThread({ sourceThreadId: thread, cwd: undefined })
            fork = forked.threadId
            const entries = yield* (yield* SessionLog).entries
            const branch = entries.find(
              (event) => event._tag === 'thread/branched' && event.thread === forked.threadId,
            )
            if (branch === undefined || branch._tag !== 'thread/branched') {
              throw new Error('the fork recorded no entry to continue from')
            }
            expect(branch.fromId).toBe(laneOf(entries, thread).at(-1)?.id)

            // The fork's memory is its source's path to the branch point, then
            // its own lane, because the branch names an entry instead of copying
            // facts.
            const memory = modelVisiblePath(entries, thread)
            expect(bodiesOf(memory)).toEqual(['user:first request', 'assistant:done'])
            const inherited = modelVisiblePath(entries, forked.threadId)
            expect(inherited.slice(0, memory.length)).toEqual(memory)
            expect(tagsOf(inherited.slice(memory.length))).toEqual([
              'thread/created',
              'thread/configured',
              'thread/branched',
            ])
            // Its lane holds no work of its own, so the fork does not run the
            // source's turn again under a second thread id.
            expect(tagsOf(laneOf(entries, forked.threadId))).toEqual([
              'thread/created',
              'thread/configured',
              'thread/branched',
            ])
            expect(workOf(foldThread(entries, forked.threadId))).toEqual(Idle.make({}))
          }),
        )

        // A source that keeps going does not change what the fork remembers: its
        // memory is the path it named, which is already written.
        yield* instance(
          file,
          Effect.gen(function* () {
            const { host, client } = yield* connect(plugins)
            yield* client.SendMessage({ threadId: thread, text: 'second request' })
            yield* (yield* host.service(Inference)).whenIdle(thread)
            const entries = yield* (yield* SessionLog).entries
            expect(bodiesOf(modelVisiblePath(entries, thread))).toEqual([
              'user:first request',
              'assistant:done',
              'user:second request',
              'assistant:done',
            ])
            expect(bodiesOf(modelVisiblePath(entries, fork))).toEqual([
              'user:first request',
              'assistant:done',
            ])
          }),
        )
      }),
    )
  })

  it('compacts a thread after a restart and keeps the view from the cut', async () => {
    const file = sessionFile()
    await Effect.runPromise(
      Effect.gen(function* () {
        const gate = openGate()
        yield* Deferred.succeed(gate, undefined)
        const plugins = pluginsFor(echoToolPlugin(gate, openGate(), yield* Ref.make(0)), [
          compactingHarnessPlugin,
        ])
        let thread = ''

        yield* instance(
          file,
          Effect.gen(function* () {
            const { host, client } = yield* connect(plugins)
            const created = yield* client.CreateThread({ cwd: '/tmp' })
            thread = created.threadId
            // The compacting bridge joins the picker but not this thread's turns.
            yield* client.ConfigureThread({
              threadId: thread,
              harness: 'oru',
              model: undefined,
              reasoning: undefined,
            })
            yield* client.SendMessage({ threadId: thread, text: 'first request' })
            yield* (yield* host.service(Inference)).whenIdle(thread)
          }),
        )

        yield* instance(
          file,
          Effect.gen(function* () {
            const { host, client } = yield* connect(plugins)
            const log = yield* SessionLog
            // The second exchange runs on the restarted host, out of the same
            // journal the first one wrote.
            yield* client.SendMessage({ threadId: thread, text: 'second request' })
            yield* (yield* host.service(Inference)).whenIdle(thread)
            yield* client.ConfigureThread({
              threadId: thread,
              harness: 'compacting',
              model: undefined,
              reasoning: undefined,
            })
            yield* client.CompactThread({ threadId: thread, instructions: undefined })
            const entries = yield* log.entries
            const compaction = entries.find(
              (event) => event._tag === 'thread/compacted' && event.thread === thread,
            )
            if (compaction === undefined || compaction._tag !== 'thread/compacted') {
              throw new Error('the compaction was recorded nowhere')
            }
            const requests = laneOf(entries, thread).filter(
              (event) => event._tag === 'message/appended' && event.role === 'user',
            )
            expect(compaction.summary).toBe('summarized')
            expect(compaction.firstKeptEntryId).toBe(requests.at(-1)?.id)
            expect(bodiesOf(modelVisiblePath(entries, thread))).toEqual([
              'user:second request',
              'assistant:done',
            ])
          }),
        )

        yield* instance(
          file,
          Effect.gen(function* () {
            yield* connect(plugins)
            const entries = yield* (yield* SessionLog).entries
            // A later host folds the same view out of the journal alone. The cut
            // keeps its tail, which includes the fact that followed the answer.
            expect(tagsOf(modelVisiblePath(entries, thread))).toEqual([
              'thread/compacted',
              'message/appended',
              'agent/inbox/spliced',
              'turn/started',
              'tool/requested',
              'tool/completed',
              'message/appended',
              'thread/configured',
            ])
            expect(bodiesOf(modelVisiblePath(entries, thread))).toEqual([
              'user:second request',
              'assistant:done',
            ])
            expect(workOf(foldThread(entries, thread))).toEqual(Idle.make({}))
          }),
        )
      }),
    )
  })
})
