import { Context } from 'effect'

/**
 * The bridge's environment, as a service rather than a factory parameter.
 *
 * A factory like `makePiHarness({ env })` forces every test to inject its fake
 * through parameters; a service lets tests use the Effect idiom instead:
 * provide another value for this tag. The composition root provides the real
 * environment with `defineValuePlugin`, tests provide the scripted one, and
 * the plugin reads whichever is active through its coeffects. This module
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
