import { Effect, Stream } from 'effect'
import type { Host, PluginId } from '@oru/kernel'
import type { PluginStore } from '../plugin-store.ts'

export const hostRpcHandlers = (host: Host, store: PluginStore) => {
  const snapshot = () => store.graphView()

  return {
    GetGraph: () => snapshot(),
    WatchGraph: () =>
      Stream.concat(
        Stream.fromEffect(snapshot()),
        Stream.merge(host.events, store.changes).pipe(Stream.mapEffect(() => snapshot())),
      ),
    SetLive: (payload: { readonly plugin: PluginId; readonly live: boolean }) =>
      Effect.gen(function* () {
        if (payload.live) {
          const plugin = yield* store.pluginRecord(payload.plugin)
          if (plugin !== undefined) yield* host.activate(plugin).pipe(Effect.ignore)
        } else {
          yield* host.deactivate(payload.plugin)
        }
        return yield* snapshot()
      }),
    ReloadPlugin: (payload: { readonly specifier: string }) => store.reload(payload.specifier),
  }
}
