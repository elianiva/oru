import { Effect, Stream } from 'effect'
import { defineService } from '@oru/kernel'

export type ModelMessage =
  | { readonly _tag: 'user'; readonly body: string }
  | { readonly _tag: 'assistant'; readonly body: string }
  | { readonly _tag: 'tool'; readonly name: string; readonly call: string; readonly result: string }

export type ModelTool = {
  readonly name: string
  readonly description: string
  readonly parametersJson: string
}

export type ModelEvent =
  | { readonly _tag: 'text'; readonly text: string }
  | {
      readonly _tag: 'tool'
      readonly name: string
      readonly call: string
      readonly arguments: string
    }

export interface ModelService {
  readonly streamTurn: (
    history: readonly ModelMessage[],
    tools: readonly ModelTool[],
  ) => Effect.Effect<Stream.Stream<ModelEvent>>
}

export const Model = defineService<ModelService>('oru/model')
