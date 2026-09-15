import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import { PluginId } from '@oru/kernel'
import { ViewGraph } from './view-graph.ts'

/**
 * The kernel graph, as a presentation facet sees it: a snapshot to start from,
 * a stream that keeps it current, and the one command that changes it.
 */
export const HostRpc = RpcGroup.make(
  Rpc.make('GetGraph', { success: ViewGraph }),
  Rpc.make('WatchGraph', { success: ViewGraph, stream: true }),
  Rpc.make('SetLive', {
    payload: { plugin: PluginId, live: Schema.Boolean },
    success: ViewGraph,
  }),
)
