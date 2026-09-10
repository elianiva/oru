import { Schema } from 'effect'
import { PluginId } from '@oru/kernel'

export const Panel = Schema.Struct({
  plugin: PluginId,
  title: Schema.String,
})
export type Panel = Schema.Schema.Type<typeof Panel>

export const ViewGraph = Schema.Struct({
  active: Schema.Array(Panel),
})
export type ViewGraph = Schema.Schema.Type<typeof ViewGraph>
