import { Schema } from 'effect'
import { HarnessHealth, ModelInfo } from '@oru/harness'

/**
 * What a thread is configured to run, and what it could run instead.
 *
 * These shapes are shared by the RPC that resolves them, the submodel that
 * renders them, and the commands that refresh them, so they live beside the
 * thread rather than inside any one of those.
 */
export const ThreadConfig = Schema.Struct({
  harness: Schema.UndefinedOr(Schema.NonEmptyString),
  model: Schema.UndefinedOr(Schema.NonEmptyString),
  reasoning: Schema.UndefinedOr(Schema.NonEmptyString),
})
export type ThreadConfig = typeof ThreadConfig.Type

/** A harness a thread can pick, with the state it is in (ADR-0023). */
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
