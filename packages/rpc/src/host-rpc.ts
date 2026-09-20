import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import { PluginId } from '@oru/kernel'
import { UiSnapshot } from '@oru/ui'
import { ViewGraph } from './view-graph.ts'

export class UnknownPlugin extends Schema.TaggedError<UnknownPlugin>()('UnknownPlugin', {
  specifier: Schema.String,
  known: Schema.Array(Schema.String),
}) {}

export class ReloadFailed extends Schema.TaggedError<ReloadFailed>()('ReloadFailed', {
  specifier: Schema.String,
  reason: Schema.String,
}) {}

export const ReloadResult = Schema.Struct({
  plugin: PluginId,
  address: Schema.optional(Schema.String),
  graph: ViewGraph,
  ui: UiSnapshot,
})
export type ReloadResult = typeof ReloadResult.Type

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
  Rpc.make('ReloadPlugin', {
    payload: { specifier: Schema.String },
    success: ReloadResult,
    error: Schema.Union([UnknownPlugin, ReloadFailed]),
  }),
)
