import { Context, Effect, Stream } from 'effect'
import type { SessionEvent, ThreadId } from '@oru/kernel'

export interface ThreadClientContract {
  readonly create: Effect.Effect<{ readonly threadId: ThreadId }>
  readonly send: (threadId: ThreadId, text: string) => Effect.Effect<void>
  readonly watch: (threadId: ThreadId) => Stream.Stream<SessionEvent>
}

export class ThreadClient extends Context.Service<ThreadClient, ThreadClientContract>()(
  'oru/ThreadClient',
) {}
