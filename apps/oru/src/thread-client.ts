import { Context, Effect, Stream } from 'effect'
import type { SessionEvent, ThreadId } from '@oru/kernel'
import type { ThreadConfig, ThreadOptions } from './thread-options.ts'
import type { ThreadSignal } from './thread-signal.ts'

/** What a thread's pane needs from the host: facts, configuration, live signals. */
export interface ThreadClientContract {
  /** A real directory, because a cwd-bound harness resumes by it (ADR-0019). */
  readonly create: (cwd?: string) => Effect.Effect<{ readonly threadId: ThreadId }>
  readonly send: (threadId: ThreadId, text: string) => Effect.Effect<void>
  readonly watch: (threadId: ThreadId) => Stream.Stream<SessionEvent>
  readonly options: (threadId: ThreadId) => Effect.Effect<ThreadOptions>
  readonly configure: (
    threadId: ThreadId,
    configuration: ThreadConfig,
  ) => Effect.Effect<ThreadOptions>
  readonly watchSignals: (threadId: ThreadId) => Stream.Stream<ThreadSignal>
  readonly stop: (threadId: ThreadId) => Effect.Effect<void>
  readonly compact: (threadId: ThreadId, instructions?: string) => Effect.Effect<void>
  readonly fork: (
    sourceThreadId: ThreadId,
    cwd?: string,
  ) => Effect.Effect<{ readonly threadId: ThreadId }>
}

export class ThreadClient extends Context.Service<ThreadClient, ThreadClientContract>()(
  'oru/ThreadClient',
) {}
