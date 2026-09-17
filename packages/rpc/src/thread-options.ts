import { Schema } from 'effect'
import { HarnessHealth, ModelInfo } from '@oru/harness'
import { ThreadConfig } from '@oru/kernel'

export { ThreadConfig }

/**
 * A configuration a caller changes; an absent member keeps the thread's current
 * value, so a caller names only what it is choosing.
 */
export interface ThreadConfiguration {
  readonly harness?: string | undefined
  readonly model?: string | undefined
  readonly reasoning?: string | undefined
}

/** A harness a thread can pick, with the state it is in (ADR-0007). */
export const HarnessChoice = Schema.Struct({
  id: Schema.NonEmptyString,
  label: Schema.String,
  health: HarnessHealth,
})
export type HarnessChoice = typeof HarnessChoice.Type

export const ThreadOptions = Schema.Struct({
  config: ThreadConfig,
  /**
   * The harness these options describe: the configured one, or the host's
   * default for a thread that names none. Absent means no active harness.
   */
  harness: Schema.UndefinedOr(Schema.NonEmptyString),
  harnesses: Schema.Array(HarnessChoice),
  /** The catalogue of that harness, empty when it cannot answer for one. */
  models: Schema.Array(ModelInfo),
})
export type ThreadOptions = typeof ThreadOptions.Type
