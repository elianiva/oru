import { Effect, Schema } from 'effect'
import { HarnessHealth, ModelInfo, ProviderInfo } from '@oru/harness'
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
  /** The harness's glyph: a lowercase Lucide key the app resolves. */
  icon: Schema.optionalKey(Schema.String),
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
  /**
   * The active harness's providers, in catalogue order; empty when it names none.
   *
   * Decoded with a default because a host predating provider metadata answers
   * without the key, and the picker must read that answer rather than fail it
   * (`Missing key at ["value"]["providers"]` on first open). The host always
   * encodes the key, so the seam stays exact going forward.
   */
  providers: Schema.Array(ProviderInfo).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** The catalogue of that harness, empty when it cannot answer for one. */
  models: Schema.Array(ModelInfo),
})
export type ThreadOptions = typeof ThreadOptions.Type
