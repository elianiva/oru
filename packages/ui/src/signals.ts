import { Schema } from 'effect'

/**
 * A one-shot signal root delivers into a def without the def's message
 * constructors. Signals are versioned plain data like props: additive-only
 * within a major. `restore-draft` puts a refused text back in the draft,
 * the way root restored its own composer before extraction.
 */
export const UiSignal = Schema.Struct({
  type: Schema.Literals(['restore-draft']),
  text: Schema.String,
})
export type UiSignal = typeof UiSignal.Type
