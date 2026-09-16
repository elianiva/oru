import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Predicate, Deferred, Effect, Fiber, Ref, Schema, Stream, type Scope } from 'effect'
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
  type SessionLogError,
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
  inferencePlugin,
  ToolKind,
  workOf,
} from '@oru/inference'
import {
  HostUnreachable,
  ThreadClient,
  ProjectClient,
  clientsFor,
  type ThreadClientContract,
} from '@oru/rpc'
import { serveHost } from '../src/index.ts'

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
 * makes the lane's facts right (ADR-0010).
 */
const pluginsFor = (echo: AnyPlugin, extra: readonly AnyPlugin[] = []): readonly AnyPlugin[] => [
  harnessRegistryPlugin,
  inferencePlugin,
  echo,
  demoModelPlugin,
  harnessOruPlugin,
  ...extra,
]

/** One database file per case, so the second host opens what the first left. */
const sessionFile = (): string => join(mkdtempSync(join(tmpdir(), 'oru-durable-')), 'session.db')

/** One served host against a journal file. The scope closing is the kill. */
const withHost = <A, E>(
  file: string,
  plugins: readonly AnyPlugin[],
  effect: Effect.Effect<A, E, ThreadClient | ProjectClient | Scope.Scope>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const running = yield* serveHost({
        plugins,
        hostname: '127.0.0.1',
        port: 0,
        journal: file,
      })
      return yield* effect.pipe(Effect.provide(clientsFor(running.url)))
    }),
  )

/** Read the journal the hosts wrote, with the host itself out of the way. */
const readJournal = <A>(
  file: string,
  read: (log: SessionLogContract) => Effect.Effect<A, SessionLogError>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const log = yield* SessionLog
        return yield* read(log)
      }).pipe(Effect.provide(sessionLogLayer), Effect.provide(sqliteJournalLayer(file))),
    ),
  )

/**
 * An open gate: the tool answers as soon as it is called, which is what a case
 * that wants its turns to finish wants. The resume case holds a closed one
 * instead, so a turn can be left in flight.
 */
const openGate = () => {
  const gate = Deferred.makeUnsafe<void>()
  Deferred.doneUnsafe(gate, Effect.void)
  return gate
}

/**
 * The facts a thread has now.
 *
 * `WatchThread` emits its snapshot before it subscribes, so a reader that stops
 * at a fact it already owns never waits for a turn to finish.
 */
const factsUntil = (
  thread: ThreadClientContract,
  threadId: string,
  stop: (event: SessionEvent) => boolean,
): Effect.Effect<readonly SessionEvent[], HostUnreachable> =>
  thread.watch(threadId).pipe(
    Stream.takeUntil(stop),
    Stream.runCollect,
    Effect.map((chunk) => [...chunk]),
  )

/**
 * The Nth answer on a thread, counting the ones its snapshot carries, so a
 * caller can subscribe before the request that produces it.
 */
const answerNumber = (
  thread: ThreadClientContract,
  threadId: string,
  nth: number,
): Effect.Effect<readonly SessionEvent[], HostUnreachable> =>
  thread.watch(threadId).pipe(
    Stream.filter(
      (event) => Predicate.isTagged(event, 'message/appended') && event.role === 'assistant',
    ),
    Stream.take(nth),
    Stream.runCollect,
    Effect.map((chunk) => [...chunk]),
  )

const tagsOf = (events: readonly SessionEvent[]): readonly string[] =>
  events.map((event) => event._tag)

const bodiesOf = (events: readonly SessionEvent[]): readonly string[] => {
  const bodies: string[] = []
  for (const event of events) {
    if (Predicate.isTagged(event, 'message/appended')) bodies.push(`${event.role}:${event.body}`)
  }
  return bodies
}

const laneOf = (entries: readonly SessionEvent[], thread: string) =>
  pathOfLane(entries, threadLane(thread))

/** Run one request and wait for its answer, so a case reads as its turns do. */
const request = (
  thread: ThreadClientContract,
  threadId: string,
  nth: number,
  text: string,
): Effect.Effect<void, HostUnreachable, Scope.Scope> =>
  Effect.gen(function* () {
    const watching = yield* answerNumber(thread, threadId, nth).pipe(Effect.forkScoped)
    yield* thread.watch(threadId).pipe(
      Stream.runForEach((event) =>
        Predicate.isTagged(event, 'tool/requested')
          ? thread.decide(threadId, event.call, 'approve')
          : Effect.void,
      ),
      Effect.forkScoped,
    )
    yield* thread.send(threadId, text)
    yield* Fiber.join(watching)
  })

const openThread = (cwd: string) =>
  Effect.gen(function* () {
    const projects = yield* ProjectClient
    const client = yield* ThreadClient
    const project = yield* projects.create('durable', cwd)
    return yield* client.create(project.id)
  })

describe('one journal, two hosts', () => {
  it('reconstructs the plugin graph from the facts the first host wrote', async () => {
    const file = sessionFile()
    const plugins = pluginsFor(echoToolPlugin(openGate(), openGate(), Ref.makeUnsafe(0)))

    const live = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost(plugins)
          yield* host.deactivate(harnessOruPlugin.id)
          return [...(yield* host.graph).active.keys()].sort()
        }).pipe(Effect.provide(sessionLogLayer), Effect.provide(sqliteJournalLayer(file))),
      ),
    )
    expect(live).toEqual(['oru/harness-registry', 'oru/inference', 'oru/model-demo', 'tools/echo'])

    // A second host against the file boots from the journal rather than from its
    // plugin list, so the deactivation the first one recorded still holds.
    const replay = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost(plugins)
          const entries = yield* (yield* SessionLog).entries
          return {
            live: [...(yield* host.graph).active.keys()].sort(),
            folded: [...foldActivePlugins(entries)].sort(),
          }
        }).pipe(Effect.provide(sessionLogLayer), Effect.provide(sqliteJournalLayer(file))),
      ),
    )
    expect(replay.live).toEqual(live)
    expect(replay.folded).toEqual(live)
  })

  it('keeps a pending approval across a host restart', async () => {
    const file = sessionFile()
    const calls = Ref.makeUnsafe(0)
    const plugins = pluginsFor(echoToolPlugin(openGate(), openGate(), calls))
    let thread = ''

    await Effect.runPromise(
      withHost(
        file,
        plugins,
        Effect.gen(function* () {
          const client = yield* ThreadClient
          const created = yield* openThread('/tmp')
          thread = created.threadId
          const watching = yield* factsUntil(client, thread, (event) =>
            Predicate.isTagged(event, 'tool/requested'),
          ).pipe(Effect.forkScoped)
          yield* client.send(thread, 'hello')
          const requested = yield* Fiber.join(watching)
          expect(workOf(foldThread(requested, thread))._tag).toBe('AwaitApproval')
          expect(yield* Ref.get(calls)).toBe(0)
        }),
      ),
    )

    await Effect.runPromise(
      withHost(
        file,
        plugins,
        Effect.gen(function* () {
          const client = yield* ThreadClient
          const atOpen = yield* factsUntil(client, thread, (event) =>
            Predicate.isTagged(event, 'tool/requested'),
          )
          expect(workOf(foldThread(atOpen, thread))._tag).toBe('AwaitApproval')
          const requested = atOpen.find((event) => Predicate.isTagged(event, 'tool/requested'))
          expect(requested).toBeDefined()
          if (!Predicate.isTagged(requested, 'tool/requested')) return
          const watching = yield* answerNumber(client, thread, 1).pipe(Effect.forkScoped)
          yield* client.decide(thread, requested.call, 'approve')
          const answers = yield* Fiber.join(watching)
          expect(bodiesOf(answers)).toEqual(['assistant:done'])
        }),
      ),
    )

    expect(Ref.getUnsafe(calls)).toBe(1)
    const lane = await readJournal(file, (log) =>
      log.entries.pipe(Effect.map((entries) => laneOf(entries, thread))),
    )
    expect(tagsOf(lane)).toEqual([
      'thread/created',
      'message/appended',
      'agent/inbox/spliced',
      'turn/started',
      'tool/requested',
      'approval/decided',
      'tool/completed',
      'message/appended',
    ])
    expect(workOf(foldThread(lane, thread))).toEqual(Idle.make({}))
  })

  it('adds a lane that reaches back to a thread created before the restart', async () => {
    const file = sessionFile()
    const plugins = pluginsFor(echoToolPlugin(openGate(), openGate(), Ref.makeUnsafe(0)))
    let thread = ''
    let fork = ''

    await Effect.runPromise(
      withHost(
        file,
        plugins,
        Effect.gen(function* () {
          const client = yield* ThreadClient
          const created = yield* openThread('/tmp')
          thread = created.threadId
          yield* request(client, thread, 1, 'first request')
        }),
      ),
    )

    await Effect.runPromise(
      withHost(
        file,
        plugins,
        Effect.gen(function* () {
          const client = yield* ThreadClient
          const created = yield* client.fork(thread)
          fork = created.threadId
          // The fork's own lane is three facts: nothing of its source is copied.
          const lane = yield* factsUntil(client, fork, (event) =>
            Predicate.isTagged(event, 'thread/branched'),
          )
          expect(tagsOf(lane)).toEqual(['thread/created', 'thread/configured', 'thread/branched'])
        }),
      ),
    )

    // Its memory is its source's path to the branch point, then its own lane.
    const memory = await readJournal(file, (log) =>
      log.entries.pipe(
        Effect.map((entries) => ({
          source: modelVisiblePath(entries, thread),
          fork: modelVisiblePath(entries, fork),
          work: workOf(foldThread(entries, fork)),
        })),
      ),
    )
    expect(bodiesOf(memory.source)).toEqual(['user:first request', 'assistant:done'])
    expect(memory.fork.slice(0, memory.source.length)).toEqual(memory.source)
    expect(tagsOf(memory.fork.slice(memory.source.length))).toEqual([
      'thread/created',
      'thread/configured',
      'thread/branched',
    ])
    // Its lane holds no work of its own, so the fork does not run its source's
    // turn again under a second thread id.
    expect(memory.work).toEqual(Idle.make({}))

    // A source that keeps talking does not change what the fork remembers: its
    // memory is the path it named, which is already written.
    await Effect.runPromise(
      withHost(
        file,
        plugins,
        Effect.gen(function* () {
          const client = yield* ThreadClient
          yield* request(client, thread, 2, 'second request')
        }),
      ),
    )
    const after = await readJournal(file, (log) =>
      log.entries.pipe(
        Effect.map((entries) => ({
          source: bodiesOf(modelVisiblePath(entries, thread)),
          fork: bodiesOf(modelVisiblePath(entries, fork)),
        })),
      ),
    )
    expect(after.source).toEqual([
      'user:first request',
      'assistant:done',
      'user:second request',
      'assistant:done',
    ])
    expect(after.fork).toEqual(['user:first request', 'assistant:done'])
  })

  it('compacts a thread after a restart and keeps the view from the cut', async () => {
    const file = sessionFile()
    const plugins = pluginsFor(echoToolPlugin(openGate(), openGate(), Ref.makeUnsafe(0)), [
      compactingHarnessPlugin,
    ])
    let thread = ''

    await Effect.runPromise(
      withHost(
        file,
        plugins,
        Effect.gen(function* () {
          const client = yield* ThreadClient
          const created = yield* openThread('/tmp')
          thread = created.threadId
          // The compacting bridge joins the picker but not this thread's turns.
          yield* client.configure(thread, {
            harness: 'oru',
            model: undefined,
            reasoning: undefined,
          })
          yield* request(client, thread, 1, 'first request')
        }),
      ),
    )

    await Effect.runPromise(
      withHost(
        file,
        plugins,
        Effect.gen(function* () {
          const client = yield* ThreadClient
          // The second exchange runs on the restarted host, out of the same
          // journal the first one wrote.
          yield* request(client, thread, 2, 'second request')
          yield* client.configure(thread, {
            harness: 'compacting',
            model: undefined,
            reasoning: undefined,
          })
          yield* client.compact(thread)
        }),
      ),
    )

    const recorded = () =>
      readJournal(file, (log) =>
        log.entries.pipe(
          Effect.map((entries) => {
            const compaction = entries.find(
              (event) => Predicate.isTagged(event, 'thread/compacted') && event.thread === thread,
            )
            return {
              compaction,
              requests: laneOf(entries, thread).filter(
                (event) => Predicate.isTagged(event, 'message/appended') && event.role === 'user',
              ),
              view: modelVisiblePath(entries, thread),
              work: workOf(foldThread(entries, thread)),
            }
          }),
        ),
      )

    const first = await recorded()
    expect(first.compaction).toBeDefined()
    if (!Predicate.isTagged(first.compaction, 'thread/compacted')) return
    expect(first.compaction.summary).toBe('summarized')
    // The bridge supplies the summary; the entry the view keeps from is oru's,
    // taken from the log rather than from the bridge's own checkpoint.
    expect(first.compaction.firstKeptEntryId).toBe(first.requests.at(-1)?.id)
    expect(bodiesOf(first.view)).toEqual(['user:second request', 'assistant:done'])

    // A later host boots from the journal and folds the same view, having
    // rewritten nothing.
    await Effect.runPromise(withHost(file, plugins, Effect.void))
    const second = await recorded()
    expect(tagsOf(second.view)).toEqual(tagsOf(first.view))
    expect(bodiesOf(second.view)).toEqual(['user:second request', 'assistant:done'])
    expect(second.work).toEqual(Idle.make({}))
  })
})
