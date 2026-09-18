import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Predicate, Effect, Match, Option, Schema, Stream, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { Harnesses } from '@oru/harness'
import { harnessRegistryPlugin } from '@oru/harness-registry'
import {
  defineTool,
  foldThread,
  Idle,
  Runtime,
  runtimePlugin,
  ToolKind,
  workOf,
} from '@oru/harness'
import {
  definePlugin,
  makeHost,
  ProjectCreated,
  SessionLog,
  sessionLogLayer,
  ThreadCreated,
  unsignedTree,
  type SessionEvent,
} from '@oru/kernel'
import { harnessPiPlugin, makePiHarness, type PiHarness } from '../src/index.ts'
import {
  SCRIPTED_MODEL,
  startScriptedProvider,
  type ScriptedProvider,
} from './scripted-provider.ts'

/**
 * The whole stack over a real pi with a scripted model: kernel log, harness
 * registry, the pi bridge, and the inference loop that drives them.
 *
 * The bridge's own tests prove it speaks pi. This proves the composition: a
 * thread that selects `pi` runs its turn through the bridge, oru executes the
 * tool, and the run lands in oru's log as facts. That is the path a real host
 * takes, minus the credentials a real model would need.
 */

const MODEL = SCRIPTED_MODEL

const EchoArgs = Schema.Struct({ text: Schema.String })

const echoToolPlugin = definePlugin({
  id: 'tools/echo',
  provides: [
    ToolKind.of(
      defineTool({
        name: 'echo',
        description: 'Return the text that was passed in.',
        parameters: EchoArgs,
        execute: (input: { readonly text: string }) =>
          Effect.succeed(JSON.stringify({ echoed: input.text })),
      }),
    ),
  ],
})

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const bridge = async (): Promise<PiHarness> => {
  const scripted: ScriptedProvider = await startScriptedProvider()
  const harness = makePiHarness({
    env: scripted.env,
    // The bridge talks to people through oru; a test has no one to tell.
    log: () => undefined,
  })
  cleanups.push(async () => {
    harness.shutdown()
    await scripted.close()
  })
  return harness
}

const approveAll = (runtime: Runtime['Service']) =>
  Effect.gen(function* () {
    const log = yield* SessionLog
    const live = yield* log.subscribe
    yield* live.pipe(
      Stream.runForEach((event) =>
        Predicate.isTagged(event, 'tool/requested')
          ? runtime.decide(event.thread, event.call, 'approve').pipe(Effect.orDie)
          : Effect.void,
      ),
      Effect.forkScoped,
    )
  })

const run = <A, E>(
  effect: Effect.Effect<A, E, EventJournal.EventJournal | Scope.Scope | SessionLog>,
) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    ),
  )

const newId = Effect.sync(() => crypto.randomUUID())

/** Open a thread under a project, the way the app's `CreateThread` does. */
const openThread = (cwd: string) =>
  Effect.gen(function* () {
    const log = yield* SessionLog
    const project = yield* newId
    yield* log.write(
      ProjectCreated.make({ ...unsignedTree, id: yield* newId, project, name: 'stack', cwd }),
    )
    const threadId = yield* newId
    yield* log.write(
      ThreadCreated.make({ ...unsignedTree, id: yield* newId, thread: threadId, project }),
    )
    return threadId
  })

const threadFacts = (events: readonly SessionEvent[], thread: string): readonly SessionEvent[] =>
  events.filter((event) =>
    Match.value(event).pipe(
      Match.tagsExhaustive({
        'plugin/activated': () => false,
        'plugin/deactivated': () => false,
        'thread/created': (event) => event.thread === thread,
        'project/created': () => false,
        'project/updated': () => false,
        'project/deleted': () => false,
        'turn/started': (event) => event.thread === thread,
        'turn/failed': (event) => event.thread === thread,
        'turn/usage': (event) => event.thread === thread,
        'thread/context-window': (event) => event.thread === thread,
        'message/appended': (event) => event.thread === thread,
        'tool/requested': (event) => event.thread === thread,
        'approval/decided': (event) => event.thread === thread,
        'tool/completed': (event) => event.thread === thread,
        'thread/compacted': (event) => event.thread === thread,
        'thread/branched': (event) => event.thread === thread,
        'thread/configured': (event) => event.thread === thread,
        'agent/inbox/spliced': (event) => event.thread === thread,
      }),
    ),
  )

const bodiesOf = (events: readonly SessionEvent[]): readonly string[] =>
  events.flatMap((event) =>
    Predicate.isTagged(event, 'message/appended') ? [`${event.role}:${event.body}`] : [],
  )

const hostsOf = (harness: PiHarness) => [
  harnessRegistryPlugin(),
  echoToolPlugin,
  harnessPiPlugin(harness),
  runtimePlugin,
]

describe('harness-pi in a host', () => {
  it("runs a turn the thread selected and records oru's facts", async () => {
    const harness = await bridge()

    await run(
      Effect.gen(function* () {
        const host = yield* makeHost(hostsOf(harness))
        const graph = yield* host.graph
        expect(graph.active.has('oru/harness-pi')).toBe(true)
        expect(graph.active.has('oru/runtime')).toBe(true)

        const runtime = yield* host.service(Runtime)
        const log = yield* SessionLog
        const thread = yield* openThread(tmpdir())

        // What the picker shows: the registry offers pi, and pi offers a model.
        const registry = yield* host.service(Harnesses)
        const offered = yield* registry.list()
        expect(offered.map((entry) => entry.harness.meta.id)).toContain('pi')
        const entry = Option.getOrThrow(yield* registry.get('pi'))
        expect((yield* entry.harness.listModels()).map((model) => model.id)).toContain(MODEL)

        yield* runtime.configure(thread, { harness: 'pi', model: MODEL })
        yield* approveAll(runtime)
        yield* runtime.send(thread, '/tool echo {"text":"hi"}')
        yield* runtime.whenIdle(thread)

        const events = threadFacts(yield* log.entries, thread)
        expect(events.map((event) => event._tag)).toEqual([
          'thread/created',
          'thread/configured',
          'message/appended',
          'agent/inbox/spliced',
          'turn/started',
          'tool/requested',
          'approval/decided',
          'tool/completed',
          'message/appended',
          'turn/usage',
          'thread/context-window',
        ])
        expect(bodiesOf(events)).toEqual([
          'user:/tool echo {"text":"hi"}',
          'assistant:Tool said: {"echoed":"hi"}',
        ])
        // The bridge paired the call with its output, so nothing is left pending.
        expect(workOf(foldThread(yield* log.entries, thread))).toEqual(Idle.make({}))
      }),
    )
  })

  it('records a tool pi ran as failed, and leaves no work behind', async () => {
    const harness = await bridge()

    await run(
      Effect.gen(function* () {
        const host = yield* makeHost(hostsOf(harness))
        const runtime = yield* host.service(Runtime)
        const log = yield* SessionLog
        const thread = yield* openThread(tmpdir())

        yield* runtime.configure(thread, { harness: 'pi', model: MODEL })
        yield* approveAll(runtime)
        // `missing` is not in the toolkit, so the extension cannot run it and pi
        // reports the call as an error.
        yield* runtime.send(thread, '/tool missing {}')
        yield* runtime.whenIdle(thread)

        const events = threadFacts(yield* log.entries, thread)
        const completed = events.find((event) => Predicate.isTagged(event, 'tool/completed'))
        expect(Predicate.isTagged(completed, 'tool/completed') ? completed.ok : null).toBe(false)
        expect(Predicate.isTagged(completed, 'tool/completed') ? completed.result : '').toBe(
          'Tool missing not found',
        )
        // A reported outcome is a fact, so nothing is left pending for the
        // runtime to run (ADR-0007).
        expect(workOf(foldThread(yield* log.entries, thread))).toEqual(Idle.make({}))
      }),
    )
  })

  it('reports a bridge failure as a failed turn, not a broken host', async () => {
    const harness = await bridge()

    await run(
      Effect.gen(function* () {
        const host = yield* makeHost(hostsOf(harness))
        const runtime = yield* host.service(Runtime)
        const log = yield* SessionLog
        const thread = yield* openThread(tmpdir())

        yield* runtime.configure(thread, { harness: 'pi', model: MODEL })
        yield* runtime.send(thread, '/fail')
        yield* runtime.whenIdle(thread)

        const events = threadFacts(yield* log.entries, thread)
        const failed = events.find((event) => Predicate.isTagged(event, 'turn/failed'))
        expect(Predicate.isTagged(failed, 'turn/failed') ? failed.reason : '').toContain(
          'scripted run failure',
        )
        // A failed turn leaves the thread idle, ready for the next prompt.
        expect(workOf(foldThread(yield* log.entries, thread))).toEqual(Idle.make({}))
      }),
    )
  })

  it('answers a health question without running anything', async () => {
    const harness = await bridge()

    await run(
      Effect.gen(function* () {
        const host = yield* makeHost(hostsOf(harness))
        const registry = yield* host.service(Harnesses)
        const entry = Option.getOrThrow(yield* registry.get('pi'))
        expect(entry.harness.health).toBeDefined()
        if (entry.harness.health === undefined) return
        const health = yield* entry.harness.health()
        expect(health.status).toBe('ready')
        expect(health.installedVersion).toBe('0.85.1')
      }),
    )
  })
})
