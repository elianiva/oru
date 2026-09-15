import { Effect, Stream } from 'effect'
import type { AnyPlugin, Host, PluginId } from '@oru/kernel'
import { viewGraphOf } from '../graph.ts'

export const hostRpcHandlers = (host: Host, plugins: readonly AnyPlugin[]) => {
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]))
  const snapshot = () => viewGraphOf(host, plugins)

  return {
    GetGraph: () => snapshot(),
    WatchGraph: () =>
      Stream.concat(
        Stream.fromEffect(snapshot()),
        Stream.mapEffect(host.events, () => snapshot()),
      ),
    SetLive: (payload: { readonly plugin: PluginId; readonly live: boolean }) =>
      Effect.gen(function* () {
        if (payload.live) {
          const plugin = byId.get(payload.plugin)
          if (plugin !== undefined) yield* host.activate(plugin).pipe(Effect.ignore)
        } else {
          yield* host.deactivate(payload.plugin)
        }
        return yield* snapshot()
      }),
  }
}
