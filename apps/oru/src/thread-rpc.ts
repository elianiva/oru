import { Clock, Effect, Match, Random, Schema, Stream } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import { SessionEvent, SessionLog, ThreadCreated, ThreadId, type Host } from '@oru/kernel'
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

const newId = Effect.fnUntraced(function* () {
  const now = yield* Clock.currentTimeMillis
  const n = yield* Random.next
  return `${now.toString(36)}-${n.toString(36).slice(2, 10)}`
})

const threadOf = (event: SessionEvent) =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      'plugin/activated': () => undefined,
      'plugin/deactivated': () => undefined,
      'thread/created': () => undefined,
      'turn/started': (event) => event.thread,
      'turn/failed': (event) => event.thread,
      'message/appended': (event) => event.thread,
      'tool/requested': (event) => event.thread,
      'tool/completed': (event) => event.thread,
    }),
  )

export const threadRpcHandlers = (host: Host) => ({
  CreateThread: () =>
    Effect.gen(function* () {
      const log = yield* SessionLog
      const threadId = yield* newId()
      yield* log.write(ThreadCreated.make({ id: yield* newId(), thread: threadId }))
      return { threadId }
    }).pipe(Effect.orDie),
  SendMessage: (payload: { readonly threadId: ThreadId; readonly text: string }) =>
    host.service(Inference).pipe(
      Effect.flatMap((inference) => inference.send(payload.threadId, payload.text)),
      Effect.orDie,
    ),
  WatchThread: (payload: { readonly threadId: ThreadId }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const log = yield* SessionLog
        const live = yield* log.subscribe
        const snapshot = (yield* log.entries).filter(
          (event) => threadOf(event) === payload.threadId,
        )
        return Stream.concat(
          Stream.fromIterable(snapshot),
          live.pipe(
            Stream.filter((event) => threadOf(event) === payload.threadId),
            Stream.orDie,
          ),
        )
      }).pipe(Effect.orDie),
    ),
})
