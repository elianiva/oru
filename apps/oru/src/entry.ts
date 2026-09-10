import { Effect, Layer, Stream } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { RpcTest } from 'effect/unstable/rpc'
import { makeHost, sessionLogLayer } from '@oru/kernel'
import { Runtime } from 'foldkit'
import { fixtureTitles, hostPlugins } from './fixtures.ts'
import { GraphRpc } from './graph-rpc.ts'
import { HostRpc, hostRpcHandlers } from './host-rpc.ts'
import { Model, init, subscriptions, update, view } from './root.ts'
import { ThreadClient } from './thread-client.ts'
import { ThreadRpc, threadRpcHandlers } from './thread-rpc.ts'

const program = Effect.gen(function* () {
  const host = yield* makeHost(hostPlugins)
  const hostClient = yield* RpcTest.makeClient(HostRpc).pipe(
    Effect.provide(HostRpc.toLayer(hostRpcHandlers(host, hostPlugins, fixtureTitles))),
  )
  const threadClient = yield* RpcTest.makeClient(ThreadRpc).pipe(
    Effect.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
  )
  const resources = Layer.mergeAll(
    Layer.succeed(GraphRpc, {
      watch: hostClient.WatchGraph().pipe(Stream.orDie),
      setLive: (plugin, live) => hostClient.SetLive({ plugin, live }).pipe(Effect.orDie),
    }),
    Layer.succeed(ThreadClient, {
      create: threadClient.CreateThread().pipe(Effect.orDie),
      send: (threadId, text) => threadClient.SendMessage({ threadId, text }).pipe(Effect.orDie),
      watch: (threadId) => threadClient.WatchThread({ threadId }).pipe(Stream.orDie),
    }),
  )
  const container = document.getElementById('root')
  const application = Runtime.makeElement({
    Model,
    init,
    update,
    view,
    subscriptions,
    container,
    resources,
  })
  Runtime.run(application)
  yield* Effect.never
})

Effect.runFork(
  Effect.scoped(
    program.pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
  ),
)
