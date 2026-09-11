import { describe, expect, it } from 'vitest'
import { Effect, Fiber, Stream } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { RpcTest } from 'effect/unstable/rpc'
import { foldActivePlugins, makeHost, SessionLog, sessionLogLayer } from '@oru/kernel'
import { foldThread, inferencePlugin, workOf } from '@oru/inference'
import {
  echoToolPlugin,
  fakeModelPlugin,
  fixturePlugins,
  fixtureTitles,
  loggingPlugin,
} from '../src/fixtures.ts'
import { HostRpc, hostRpcHandlers } from '../src/host-rpc.ts'
import { ThreadRpc, threadRpcHandlers } from '../src/thread-rpc.ts'

describe('assembled architecture', () => {
  it('watches a thread stream, logs every turn fact, and reconstructs idle state from the journal', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const plugins = [...fixturePlugins, echoToolPlugin, fakeModelPlugin, inferencePlugin]
          const host = yield* makeHost(plugins)
          const log = yield* SessionLog
          const hostClient = yield* RpcTest.makeClient(HostRpc).pipe(
            Effect.provide(HostRpc.toLayer(hostRpcHandlers(host, plugins, fixtureTitles))),
          )
          const threadClient = yield* RpcTest.makeClient(ThreadRpc).pipe(
            Effect.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
          )

          const graph = yield* hostClient.GetGraph()
          expect(graph.active.map((panel) => panel.plugin).sort()).toEqual([
            'greeter',
            'logging',
            'model/fake',
            'oru/inference',
            'tools/echo',
          ])
          expect([...foldActivePlugins(yield* log.entries)].sort()).toEqual(
            [...(yield* host.graph).active.keys()].sort(),
          )

          const created = yield* threadClient.CreateThread()
          const watchFiber = yield* threadClient
            .WatchThread({ threadId: created.threadId })
            .pipe(Stream.take(5), Stream.runCollect, Effect.forkScoped)
          yield* threadClient.SendMessage({ threadId: created.threadId, text: 'hello' })
          const streamed = yield* Fiber.join(watchFiber)

          expect(streamed.map((event) => event._tag)).toEqual([
            'message/appended',
            'turn/started',
            'tool/requested',
            'tool/completed',
            'message/appended',
          ])

          const entries = yield* log.entries
          expect(workOf(foldThread(entries, created.threadId))).toEqual({ _tag: 'Idle' })
          expect(workOf(foldThread([...streamed], created.threadId))).toEqual({ _tag: 'Idle' })

          const down = yield* hostClient.SetLive({ plugin: loggingPlugin.id, live: false })
          expect(down.active.some((panel) => panel.plugin === 'greeter')).toBe(false)
          expect(foldActivePlugins(yield* log.entries).has('greeter')).toBe(false)
          expect(foldActivePlugins(yield* log.entries).has('logging')).toBe(false)
        }).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
      ),
    )
  })
})
