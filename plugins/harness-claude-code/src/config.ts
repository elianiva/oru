import { Context } from 'effect'

/**
 * The bridge's environment, as a service rather than a factory parameter.
 *
 * Configuration arrives as a service rather than a factory parameter, so
 * tests use the Effect idiom instead of injecting fakes through parameters:
 * the composition root provides the real environment with
 * `Effect.provideService`, tests provide the scripted one, and
 * the plugin reads whichever is active through its coeffects. This module
 * stays dependency-free so the host can provide the value without statically
 * importing the bridge.
 */
export interface ClaudeConfigValue {
  readonly env?: NodeJS.ProcessEnv | undefined
  readonly log?: ((message: string) => void) | undefined
}

export class ClaudeConfig extends Context.Service<ClaudeConfig, ClaudeConfigValue>()(
  'oru/harness-claude-code/config',
) {}
