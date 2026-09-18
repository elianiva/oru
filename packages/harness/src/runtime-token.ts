import { Context, type Effect, type Stream } from 'effect'
import type { SessionLogError } from '@oru/kernel'
import type { HarnessError, HarnessEvent, HarnessForkRequest, ModelInfo } from './harness.ts'

/** The host's turn driver. Provided by the host process, not by a plugin. */
export interface RuntimeContract {
  readonly send: (thread: string, text: string) => Effect.Effect<void, SessionLogError>
  readonly whenIdle: (thread: string) => Effect.Effect<void, SessionLogError>
  readonly resume: () => Effect.Effect<void>
  readonly listModels: () => Effect.Effect<readonly ModelInfo[], HarnessError>
  readonly steer: (thread: string, text: string) => Effect.Effect<void, SessionLogError>
  readonly abort: (thread: string) => Effect.Effect<void, SessionLogError>
  readonly configure: (
    thread: string,
    configuration: {
      readonly harness?: string | undefined
      readonly model?: string | undefined
      readonly reasoning?: string | undefined
    },
  ) => Effect.Effect<void, SessionLogError>
  readonly stop: (thread: string) => Effect.Effect<void, SessionLogError | HarnessError>
  readonly discard: (thread: string) => Effect.Effect<void, SessionLogError | HarnessError>
  readonly fork: (
    request: HarnessForkRequest,
  ) => Effect.Effect<void, SessionLogError | HarnessError>
  readonly compact: (
    thread: string,
    instructions?: string,
  ) => Effect.Effect<void, SessionLogError | HarnessError>
  readonly decide: (
    thread: string,
    request: string,
    decision: 'approve' | 'deny',
  ) => Effect.Effect<void, SessionLogError>
  readonly signals: Stream.Stream<{ readonly thread: string; readonly event: HarnessEvent }>
}

export class Runtime extends Context.Service<Runtime, RuntimeContract>()('oru/runtime') {}
