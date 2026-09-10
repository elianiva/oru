import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { RpcTest } from 'effect/unstable/rpc'
import { makeHost } from '@oru/kernel'
import { fixturePlugins, fixtureTitles, loggingPlugin } from '../src/fixtures.ts'
import { HostRpc, hostRpcHandlers } from '../src/host-rpc.ts'

describe('host rpc', () => {
  it('toggles the provider and the consumer leaves and returns in the graph', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost(fixturePlugins)
          const client = yield* RpcTest.makeClient(HostRpc).pipe(
            Effect.provide(HostRpc.toLayer(hostRpcHandlers(host, fixturePlugins, fixtureTitles))),
          )

          const boot = yield* client.GetGraph()
          expect(boot.active.map((panel) => panel.plugin).sort()).toEqual(['greeter', 'logging'])
          expect(boot.active.map((panel) => panel.title).sort()).toEqual(['Greet', 'Log'])

          const down = yield* client.SetLive({ plugin: loggingPlugin.id, live: false })
          expect(down.active).toEqual([])

          const up = yield* client.SetLive({ plugin: loggingPlugin.id, live: true })
          expect(up.active.map((panel) => panel.plugin).sort()).toEqual(['greeter', 'logging'])
        }).pipe(Effect.provide(EventJournal.layerMemory)),
      ),
    )
  })
})
