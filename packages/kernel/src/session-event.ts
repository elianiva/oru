import { Schema } from 'effect'
import { PluginId, PluginScope } from './primitives.ts'

export const PluginActivated = Schema.TaggedStruct('plugin/activated', {
  plugin: PluginId,
  scope: PluginScope,
})

export const PluginDeactivated = Schema.TaggedStruct('plugin/deactivated', {
  plugin: PluginId,
  scope: PluginScope,
})

export const SessionEvent = Schema.Union([PluginActivated, PluginDeactivated])
export type SessionEvent = Schema.Schema.Type<typeof SessionEvent>
