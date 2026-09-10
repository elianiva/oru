import { Context, Effect, Stream } from 'effect'
import type { PluginId } from '@oru/kernel'
import type { ViewGraph } from './view-graph.ts'

export interface GraphRpcContract {
  readonly watch: Stream.Stream<ViewGraph>
  readonly setLive: (plugin: PluginId, live: boolean) => Effect.Effect<ViewGraph>
}

export class GraphRpc extends Context.Service<GraphRpc, GraphRpcContract>()('oru/GraphRpc') {}
