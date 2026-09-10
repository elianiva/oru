import { Effect, Layer, Stream } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { RpcTest } from 'effect/unstable/rpc'
import { makeHost } from '@oru/kernel'
import { Runtime } from 'foldkit'
import { fixturePlugins, fixtureTitles } from './fixtures.ts'
import { GraphRpc } from './graph-rpc.ts'
import { HostRpc, hostRpcHandlers } from './host-rpc.ts'
import { Model, init, subscriptions, update, view } from './root.ts'

const program = Effect.gen(function* () {
  const host = yield* makeHost(fixturePlugins)
  const client = yield* RpcTest.makeClient(HostRpc).pipe(
    Effect.provide(HostRpc.toLayer(hostRpcHandlers(host, fixturePlugins, fixtureTitles))),
  )
  const resources = Layer.succeed(GraphRpc, {
    watch: client.WatchGraph().pipe(Stream.orDie),
    setLive: (plugin, live) => client.SetLive({ plugin, live }).pipe(Effect.orDie),
  })
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

Effect.runFork(Effect.scoped(program.pipe(Effect.provide(EventJournal.layerMemory))))
