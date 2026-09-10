import { type Effect, Schema } from 'effect'
import { defineContributionKind } from '@oru/kernel'

export const ToolOutcome = Schema.Struct({
  ok: Schema.Boolean,
  result: Schema.String,
})
export type ToolOutcome = typeof ToolOutcome.Type

export interface ToolContribution {
  readonly name: string
  readonly description: string
  readonly execute: (argumentsJson: string) => Effect.Effect<ToolOutcome>
}

export const ToolKind = defineContributionKind<ToolContribution>('oru/tool')
