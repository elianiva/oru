import { Schema } from 'effect'
import { PluginId, TokenId } from '@oru/kernel'

export const Panel = Schema.Struct({
  plugin: PluginId,
  title: Schema.String,
})
export type Panel = typeof Panel.Type

export const ViewGraph = Schema.Struct({
  active: Schema.Array(Panel),
  tokens: Schema.Array(TokenId),
})
export type ViewGraph = typeof ViewGraph.Type
