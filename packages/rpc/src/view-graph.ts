import { Schema } from 'effect'
import { PluginId, TokenId } from '@oru/kernel'

export const Panel = Schema.Struct({
  plugin: PluginId,
  title: Schema.String,
})
export type Panel = typeof Panel.Type

/**
 * What the view mirrors: the plugins that carry a panel, the service tokens the
 * host can resolve right now, and whether anything is running an agent loop
 * (ADR-0004). A plugin without a panel is live in the kernel and absent here,
 * because the view composes panels, not plugins.
 */
export const ViewGraph = Schema.Struct({
  active: Schema.Array(Panel),
  tokens: Schema.Array(TokenId),
  /** A thread has something to run: the agent loop's token has a provider. */
  agent: Schema.Boolean,
})
export type ViewGraph = typeof ViewGraph.Type
