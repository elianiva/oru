import { describe, expect, it } from 'vitest'
import { Context, Effect } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { RpcTest } from 'effect/unstable/rpc'
import {
  definePlugin,
  foldNamedThreads,
  makeHost,
  MessageAppended,
  SessionLog,
  sessionLogLayer,
  unsignedTree,
} from '@oru/kernel'
import {
  demoModelPlugin,
  foldThread,
  Idle,
  Inference,
  inferencePlugin,
  workOf,
} from '@oru/inference'
import { echoToolPlugin } from '../src/fixtures.ts'
import { ThreadRpc, threadRpcHandlers } from '../src/thread-rpc.ts'

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
        })
      }),
  },
})

describe('thread rpc', () => {
  it('records CreateThread as a journal fact without SendMessage', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([echoToolPlugin, inferencePlugin])
          const client = yield* RpcTest.makeClient(ThreadRpc).pipe(
            Effect.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
          )
          const created = yield* client.CreateThread()
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
          const host = yield* makeHost([echoToolPlugin, demoModelPlugin, inferencePlugin])
          const client = yield* RpcTest.makeClient(ThreadRpc).pipe(
            Effect.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
          )
          const created = yield* client.CreateThread()
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
          const host = yield* makeHost([echoToolPlugin, demoModelPlugin, inferencePlugin])
          yield* host.deactivate(inferencePlugin.id)
          yield* host.activate(stubEnginePlugin)
          const graph = yield* host.graph
          expect(graph.active.has('oru/inference')).toBe(false)
          expect(graph.active.has('engines/stub')).toBe(true)
          expect(graph.providers.get(Inference.key)).toBe('engines/stub')
          const client = yield* RpcTest.makeClient(ThreadRpc).pipe(
            Effect.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
          )
          const created = yield* client.CreateThread()
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
