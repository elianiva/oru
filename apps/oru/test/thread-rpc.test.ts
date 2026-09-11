import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { RpcTest } from 'effect/unstable/rpc'
import { foldNamedThreads, makeHost, SessionLog, sessionLogLayer, ThreadCreated } from '@oru/kernel'
import { foldThread, Idle, inferencePlugin, workOf, demoModelLayer } from '@oru/inference'
import { echoToolPlugin } from '../src/fixtures.ts'
import { ThreadRpc, threadRpcHandlers } from '../src/thread-rpc.ts'

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
          const createdEvent = threadFacts[0]
          if (createdEvent === undefined) throw new Error('expected thread/created')
          expect(createdEvent).toEqual(
            ThreadCreated.make({ id: createdEvent.id, thread: created.threadId }),
          )
          expect(foldNamedThreads(entries).has(created.threadId)).toBe(true)
          expect(workOf(foldThread(entries, created.threadId))).toEqual(Idle.make({}))
        }).pipe(
          Effect.provide(sessionLogLayer),
          Effect.provide(EventJournal.layerMemory),
          Effect.provide(demoModelLayer),
        ),
      ),
    )
  })

  it('sends a message and watches turn and tool facts for that thread', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([echoToolPlugin, inferencePlugin])
          const client = yield* RpcTest.makeClient(ThreadRpc).pipe(
            Effect.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
          )
          const created = yield* client.CreateThread()
          yield* client.SendMessage({ threadId: created.threadId, text: 'hello' })
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
        }).pipe(
          Effect.provide(sessionLogLayer),
          Effect.provide(EventJournal.layerMemory),
          Effect.provide(demoModelLayer),
        ),
      ),
    )
  })
})
