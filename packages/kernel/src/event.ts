import { Schema } from 'effect'
import { PluginId, PluginScope, TokenId } from './primitives.ts'

export const PluginActivated = Schema.TaggedStruct('PluginActivated', {
  plugin: PluginId,
  scope: PluginScope,
})

export const PluginDeactivated = Schema.TaggedStruct('PluginDeactivated', {
  plugin: PluginId,
  scope: PluginScope,
})

export const ProviderRemoved = Schema.TaggedStruct('ProviderRemoved', {
  token: TokenId,
  plugin: PluginId,
})

export const HostEvent = Schema.Union([PluginActivated, PluginDeactivated, ProviderRemoved])
export type HostEvent = Schema.Schema.Type<typeof HostEvent>
