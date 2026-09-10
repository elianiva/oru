import { Context, Effect, Schema, Stream } from 'effect'

export const UserMessage = Schema.TaggedStruct('user', { body: Schema.String })
export const AssistantMessage = Schema.TaggedStruct('assistant', { body: Schema.String })
export const ToolMessage = Schema.TaggedStruct('tool', {
  name: Schema.String,
  call: Schema.String,
  result: Schema.String,
})
export const ModelMessage = Schema.Union([UserMessage, AssistantMessage, ToolMessage])
export type ModelMessage = typeof ModelMessage.Type

export const ModelTool = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  parametersJson: Schema.String,
})
export type ModelTool = typeof ModelTool.Type

export const TextEvent = Schema.TaggedStruct('text', { text: Schema.String })
export const ToolEvent = Schema.TaggedStruct('tool', {
  name: Schema.String,
  call: Schema.String,
  arguments: Schema.String,
})
export const ModelEvent = Schema.Union([TextEvent, ToolEvent])
export type ModelEvent = typeof ModelEvent.Type

export interface ModelService {
  readonly streamTurn: (
    history: readonly ModelMessage[],
    tools: readonly ModelTool[],
  ) => Effect.Effect<Stream.Stream<ModelEvent>>
}

export class Model extends Context.Service<Model, ModelService>()('oru/model') {}
