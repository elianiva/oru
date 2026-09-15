import { describe, expect, it } from 'vitest'
import { Context, Effect, Fiber, Stream } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { RpcTest } from 'effect/unstable/rpc'
import {
  definePlugin,
  foldNamedThreads,
  foldThreadConfig as foldConfig,
  makeHost,
  MessageAppended,
  pathOfLane,
  SessionLog,
  sessionLogLayer,
  threadLane,
  unsignedTree,
} from '@oru/kernel'
import { harnessOruPlugin } from '@oru/harness-oru'
import { harnessRegistryPlugin } from '@oru/harness-registry'
import {
  demoModelPlugin,
  foldThread,
  Idle,
  Inference,
  inferencePlugin,
  workOf,
} from '@oru/inference'
import { HarnessKind, defaultCapabilities, defineHarness } from '@oru/harness'
import { echoToolPlugin } from '../src/fixtures.ts'
import { ThreadRpc, threadRpcHandlers } from '../src/thread-rpc.ts'

/**
 * A second bridge, so the picker has something to pick. It never runs a turn
 * here; what it proves is that the host offers whatever the registry holds and
 * that a choice reaches the runtime as a fact.
 */
const scriptedHarness = defineHarness({
  meta: { id: 'scripted', label: 'Scripted' },
  capabilities: { ...defaultCapabilities, tools: false, ownsHistory: true },
  listModels: () => Effect.succeed([{ id: 'scripted/one', label: 'Scripted One' }]),
  streamTurn: () => Stream.empty,
})

const scriptedHarnessPlugin = definePlugin({
  id: 'oru/harness-scripted',
  provides: [HarnessKind.of(scriptedHarness)],
})

const stubEnginePlugin = definePlugin({
  id: 'engines/stub',
  provides: [Inference],
  server: {
    setup: () =>
      Effect.gen(function* () {
        const log = yield* SessionLog
        return Context.make(Inference, {
          send: (thread, text) =>
            log.write(
              MessageAppended.make({
                ...unsignedTree,
                id: `stub-${thread}`,
                thread,
                role: 'user',
                body: text,
              }),
            ),
          whenIdle: () => Effect.void,
          resume: () => Effect.void,
          listModels: () => Effect.succeed([]),
          steer: (thread, text) =>
            log.write(
              MessageAppended.make({
                ...unsignedTree,
                id: `stub-steer-${thread}`,
                thread,
                role: 'user',
                body: text,
              }),
            ),
          abort: () => Effect.void,
          configure: () => Effect.void,
          stop: () => Effect.void,
          discard: () => Effect.void,
          fork: () => Effect.void,
          compact: () => Effect.void,
          signals: Stream.empty,
        })
      }),
  },
})

describe('thread rpc', () => {
  it('records CreateThread as a journal fact without SendMessage', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([harnessRegistryPlugin, echoToolPlugin, inferencePlugin])
          const client = yield* RpcTest.makeClient(ThreadRpc).pipe(
            Effect.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
          )
          const created = yield* client.CreateThread({ cwd: undefined })
          const log = yield* SessionLog
          const entries = yield* log.entries
          const threadFacts = entries.filter(
            (event) => event._tag !== 'plugin/activated' && event._tag !== 'plugin/deactivated',
          )
          const createdEvent = threadFacts.find((event) => event._tag === 'thread/created')
          if (createdEvent === undefined || createdEvent._tag !== 'thread/created') {
            throw new Error('expected thread/created')
          }
          expect(createdEvent.thread).toBe(created.threadId)
          expect(createdEvent.project.length).toBeGreaterThan(0)
          expect(foldNamedThreads(entries).has(created.threadId)).toBe(true)
          expect(workOf(foldThread(entries, created.threadId))).toEqual(Idle.make({}))
        }).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
      ),
    )
  })

  it('sends a message and watches turn and tool facts for that thread', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([
            harnessRegistryPlugin,
            echoToolPlugin,
            demoModelPlugin,
            harnessOruPlugin,
            inferencePlugin,
          ])
          const client = yield* RpcTest.makeClient(ThreadRpc).pipe(
            Effect.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
          )
          const created = yield* client.CreateThread({ cwd: undefined })
          yield* client.SendMessage({ threadId: created.threadId, text: 'hello' })
          const inference = yield* host.service(Inference)
          yield* inference.whenIdle(created.threadId)
          const log = yield* SessionLog
          const tags: string[] = []
          for (const event of yield* log.entries) {
            if (event._tag === 'plugin/activated' || event._tag === 'plugin/deactivated') continue
            tags.push(event._tag)
          }
          expect(tags).toContain('message/appended')
          expect(tags).toContain('turn/started')
          expect(tags).toContain('tool/requested')
          expect(tags).toContain('tool/completed')
        }).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
      ),
    )
  })

  it('keeps SendMessage after a stub engine replaces oru/inference', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([
            harnessRegistryPlugin,
            echoToolPlugin,
            demoModelPlugin,
            harnessOruPlugin,
            inferencePlugin,
          ])
          yield* host.deactivate(inferencePlugin.id)
          yield* host.activate(stubEnginePlugin)
          const graph = yield* host.graph
          expect(graph.active.has('oru/inference')).toBe(false)
          expect(graph.active.has('engines/stub')).toBe(true)
          expect(graph.providers.get(Inference.key)).toBe('engines/stub')
          const client = yield* RpcTest.makeClient(ThreadRpc).pipe(
            Effect.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
          )
          const created = yield* client.CreateThread({ cwd: undefined })
          yield* client.SendMessage({ threadId: created.threadId, text: 'hello' })
          const log = yield* SessionLog
          const tags: string[] = []
          const bodies: string[] = []
          for (const event of yield* log.entries) {
            if (event._tag === 'plugin/activated' || event._tag === 'plugin/deactivated') continue
            tags.push(event._tag)
            if (event._tag === 'message/appended') bodies.push(`${event.role}:${event.body}`)
          }
          expect(tags).toContain('message/appended')
          expect(tags).not.toContain('turn/started')
          expect(bodies).toEqual(['user:hello'])
        }).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
      ),
    )
  })
})

describe('thread configuration', () => {
  const setup = () =>
    Effect.gen(function* () {
      const host = yield* makeHost([
        harnessRegistryPlugin,
        echoToolPlugin,
        demoModelPlugin,
        harnessOruPlugin,
        scriptedHarnessPlugin,
        inferencePlugin,
      ])
      const client = yield* RpcTest.makeClient(ThreadRpc).pipe(
        Effect.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
      )
      return { host, client }
    })

  it('offers every registered harness and the catalogue of the default one', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { client } = yield* setup()
          const created = yield* client.CreateThread({ cwd: undefined })
          const options = yield* client.ThreadOptions({ threadId: created.threadId })
          expect(options.harnesses.map((choice) => choice.id).sort()).toEqual(['oru', 'scripted'])
          expect(options.config).toEqual({
            harness: undefined,
            model: undefined,
            reasoning: undefined,
          })
          // The default harness is `oru` (first by plugin id), so its catalogue
          // is what a thread that never chose would run.
          expect(options.models.map((model) => model.id)).toContain('mock')
        }).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
      ),
    )
  })

  it('records the choice as a fact and answers with the chosen catalogue', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { client } = yield* setup()
          const log = yield* SessionLog
          const created = yield* client.CreateThread({ cwd: undefined })

          const configured = yield* client.ConfigureThread({
            threadId: created.threadId,
            harness: 'scripted',
            model: 'scripted/one',
            reasoning: undefined,
          })
          expect(configured.config).toEqual({
            harness: 'scripted',
            model: 'scripted/one',
            reasoning: undefined,
          })
          expect(configured.models.map((model) => model.id)).toEqual(['scripted/one'])

          const facts = (yield* log.entries).filter(
            (event) => event._tag === 'thread/configured' && event.thread === created.threadId,
          )
          expect(facts).toHaveLength(1)
          expect(foldConfig(yield* log.entries, created.threadId)).toEqual({
            harness: 'scripted',
            model: 'scripted/one',
            reasoning: undefined,
          })
        }).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
      ),
    )
  })

  it('streams live signals while a turn runs', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { client } = yield* setup()
          const created = yield* client.CreateThread({ cwd: undefined })
          const watched = yield* client.WatchSignals({ threadId: created.threadId }).pipe(
            Stream.takeUntil((signal) => signal._tag === 'settled'),
            Stream.runCollect,
            Effect.forkScoped,
          )
          yield* client.SendMessage({ threadId: created.threadId, text: 'hello' })
          const seen = yield* Fiber.join(watched)
          // The pane watched the turn happen: the model called a tool before it
          // answered, and the turn closed with a settled signal.
          expect(seen.map((signal) => signal._tag)).toContain('tool-start')
          expect(seen.at(-1)?._tag).toBe('settled')
        }).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
      ),
    )
  })

  it('reprojects a fork on the log when the bridge cannot copy a session', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { host, client } = yield* setup()
          const log = yield* SessionLog
          const created = yield* client.CreateThread({ cwd: undefined })
          // harness-oru keeps no session of its own, so releasing one is a no-op
          // rather than a failure.
          yield* client.StopThread({ threadId: created.threadId })
          yield* client.DiscardThread({ threadId: created.threadId })
          const forked = yield* client.ForkThread({
            sourceThreadId: created.threadId,
            cwd: undefined,
          })
          const entries = yield* log.entries
          const sourceLeaf = pathOfLane(entries, threadLane(created.threadId)).at(-1)
          const branch = entries.find(
            (event) => event._tag === 'thread/branched' && event.thread === forked.threadId,
          )
          // Forking does not need the bridge's snapshot: the new lane names the
          // entry it continues from, and a restart reprojects it (ADR-0009).
          expect(branch?._tag === 'thread/branched' ? branch.fromId : '').toBe(sourceLeaf?.id)
          expect(
            pathOfLane(entries, threadLane(forked.threadId)).map((event) => event._tag),
          ).toEqual(['thread/created', 'thread/configured', 'thread/branched'])
          expect(workOf(foldThread(entries, forked.threadId))).toEqual(Idle.make({}))
          const inference = yield* host.service(Inference)
          yield* inference.whenIdle(forked.threadId)
        }).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
      ),
    )
  })
})
