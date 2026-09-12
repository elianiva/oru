import { Clock, Effect, Random, Schema, Stream } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import {
  ProjectCreated,
  SessionEvent,
  SessionLog,
  ThreadCreated,
  ThreadId,
  threadOf,
  unsignedTree,
  type Host,
} from '@oru/kernel'
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

export const threadRpcHandlers = (host: Host) => ({
  CreateThread: () =>
    Effect.gen(function* () {
      const log = yield* SessionLog
      const entries = yield* log.entries
      let project: string | undefined
      for (const event of entries) {
        if (event._tag === 'project/created') project = event.project
      }
      if (project === undefined) {
        project = yield* newId()
        yield* log.write(
          ProjectCreated.make({
            ...unsignedTree,
            id: yield* newId(),
            project,
            name: 'default',
            cwd: '.',
          }),
        )
      }
      const threadId = yield* newId()
      yield* log.write(
        ThreadCreated.make({
          ...unsignedTree,
          id: yield* newId(),
          thread: threadId,
          project,
        }),
      )
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
