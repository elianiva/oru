import { type Effect, Schema } from 'effect'
import * as Tool from '@effect-uai/core/Tool'
import { contribute, defineContributionKind } from '@oru/kernel'

export interface ToolContribution {
  readonly name: string
  readonly description: string
  readonly localTool: Tool.AnyLocalTool
}

export const defineTool = <A>(spec: {
  readonly name: string
  readonly description: string
  readonly parameters: Schema.Schema<A>
  readonly execute: (input: A) => Effect.Effect<unknown>
}): ToolContribution => ({
  name: spec.name,
  description: spec.description,
  localTool: Tool.make({
    name: spec.name,
    description: spec.description,
    // SAFETY: defineTool only accepts Effect Schema values; fromEffectSchema adds Standard Schema
    inputSchema: Tool.fromEffectSchema(spec.parameters as Schema.Codec<A>),
    run: (input) => spec.execute(input),
  }),
})

export const ToolKind = defineContributionKind<ToolContribution>('oru/tool')

export const contributeTool = (spec: ToolContribution) => contribute(ToolKind, spec)
