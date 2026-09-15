import { Schema } from 'effect'
import { HarnessHealth, ModelInfo } from '@oru/harness'
import { ThreadConfig } from '@oru/kernel'

export { ThreadConfig }

/** A harness a thread can pick, with the state it is in (ADR-0007). */
export const HarnessChoice = Schema.Struct({
  id: Schema.NonEmptyString,
  label: Schema.String,
  health: HarnessHealth,
})
export type HarnessChoice = typeof HarnessChoice.Type

export const ThreadOptions = Schema.Struct({
  config: ThreadConfig,
  harnesses: Schema.Array(HarnessChoice),
  /** The catalogue of the configured harness, or of the default one. */
  models: Schema.Array(ModelInfo),
})
export type ThreadOptions = typeof ThreadOptions.Type
