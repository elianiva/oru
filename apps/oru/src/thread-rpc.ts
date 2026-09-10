import { Effect, Schema, Stream } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import { SessionEvent, SessionLog, ThreadId, type Host } from '@oru/kernel'
import { Inference } from '@oru/inference'

export const ThreadRpc = RpcGroup.make(
  Rpc.make('CreateThread', { success: Schema.Struct({ threadId: ThreadId }) }),
  Rpc.make('SendMessage', {
    payload: { threadId: ThreadId, text: Schema.String },
    success: Schema.Void,
  }),
  Rpc.make('WatchThread', {
    payload: { threadId: ThreadId },
    success: SessionEvent,
    stream: true,
  }),
)

const threadOf = (event: SessionEvent): string | undefined => {
  switch (event._tag) {
    case 'plugin/activated':
    case 'plugin/deactivated':
      return undefined
    default:
      return event.thread
  }
}

export const threadRpcHandlers = (host: Host) => ({
  CreateThread: () =>
    Effect.sync(() => ({
      threadId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    })),
  SendMessage: (payload: { readonly threadId: ThreadId; readonly text: string }) =>
    host.service(Inference).pipe(
      Effect.flatMap((inference) => inference.send(payload.threadId, payload.text)),
      Effect.orDie,
    ),
  WatchThread: (payload: { readonly threadId: ThreadId }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const log = yield* SessionLog
        const snapshot = (yield* log.entries).filter(
          (event) => threadOf(event) === payload.threadId,
        )
        return Stream.concat(
          Stream.fromIterable(snapshot),
          log.changes.pipe(
            Stream.filter((event) => threadOf(event) === payload.threadId),
            Stream.orDie,
          ),
        )
      }).pipe(Effect.orDie),
    ),
})
