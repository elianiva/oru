import { Context } from 'effect'

/**
 * The bridge's environment, as a service rather than a factory parameter.
 *
 * Configuration arrives as a service rather than a factory parameter: the
 * composition root provides the real environment with
 * `Effect.provideService`, tests provide the scripted one, and the plugin
 * reads whichever value is ambient. This module
 * stays dependency-free so the host can provide the value without statically
 * importing the bridge.
 */
export interface PiBridgeConfigValue {
  readonly env?: NodeJS.ProcessEnv | undefined
  readonly log?: ((message: string) => void) | undefined
}

export class PiBridgeConfig extends Context.Service<PiBridgeConfig, PiBridgeConfigValue>()(
  'oru/harness-pi/config',
) {}
