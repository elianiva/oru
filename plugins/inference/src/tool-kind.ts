import type { Effect } from 'effect'
import { defineContributionKind } from '@oru/kernel'

export interface ToolOutcome {
  readonly ok: boolean
  readonly result: string
}

export interface ToolContribution {
  readonly name: string
  readonly description: string
  readonly execute: (argumentsJson: string) => Effect.Effect<ToolOutcome>
}

export const ToolKind = defineContributionKind<ToolContribution>('oru/tool')
