import { ThreadConfig } from '@oru/kernel'

export { ThreadConfig }
export { HarnessChoice, ThreadOptions } from '@oru/ui'

/**
 * A configuration a caller changes; an absent member keeps the thread's current
 * value, so a caller names only what it is choosing.
 */
export interface ThreadConfiguration {
  readonly harness?: string | undefined
  readonly model?: string | undefined
  readonly reasoning?: string | undefined
}
