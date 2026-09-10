import { Effect, Stream } from 'effect'
import { defineService, type PluginId } from '@oru/kernel'
import type { ViewGraph } from './view-graph.ts'

export interface GraphRpc {
  readonly watch: Stream.Stream<ViewGraph>
  readonly setLive: (plugin: PluginId, live: boolean) => Effect.Effect<ViewGraph>
}

export const GraphRpc = defineService<GraphRpc>('oru/GraphRpc')
