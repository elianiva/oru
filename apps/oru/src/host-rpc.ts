import { Effect, Option, Schema, Stream } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import type { AnyPlugin, Host, PluginId } from '@oru/kernel'
import { PluginId as PluginIdSchema } from '@oru/kernel'
import { decodePanelUi } from './fixtures.ts'
import { ViewGraph } from './view-graph.ts'

export const HostRpc = RpcGroup.make(
  Rpc.make('GetGraph', { success: ViewGraph }),
  Rpc.make('WatchGraph', { success: ViewGraph, stream: true }),
  Rpc.make('SetLive', {
    payload: { plugin: PluginIdSchema, live: Schema.Boolean },
    success: ViewGraph,
  }),
)

const titleOf = (
  plugin: AnyPlugin | undefined,
  pluginId: PluginId,
  titles: ReadonlyMap<string, string>,
) => {
  if (plugin !== undefined) {
    const ui = decodePanelUi(plugin.ui)
    if (Option.isSome(ui)) return ui.value.title
  }
  return titles.get(pluginId) ?? pluginId
}

export const viewGraphOf = Effect.fnUntraced(function* (
  host: Host,
  titles: ReadonlyMap<string, string>,
  plugins: readonly AnyPlugin[],
) {
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]))
  const graph = yield* host.graph
  return {
    active: [...graph.active.keys()].map((plugin) => ({
      plugin,
      title: titleOf(byId.get(plugin), plugin, titles),
    })),
  }
})

export const hostRpcHandlers = (
  host: Host,
  plugins: readonly AnyPlugin[],
  titles: ReadonlyMap<string, string>,
) => {
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]))
  const snapshot = () => viewGraphOf(host, titles, plugins)

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
