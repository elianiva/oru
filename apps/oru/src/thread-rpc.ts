import { Clock, Effect, Option, Random, Result, Schema, Stream } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import { HarnessHealth, Harnesses, ModelInfo, type HarnessService } from '@oru/harness'
import {
  ProjectCreated,
  SessionEvent,
  SessionLog,
  ThreadCreated,
  ThreadId,
  foldThreadConfig,
  foldThreadCwd,
  threadOf,
  unsignedTree,
  type Host,
  type SessionLogError,
} from '@oru/kernel'
import { Inference } from '@oru/inference'
import { HarnessChoice, ThreadOptions } from './thread-options.ts'
import { ThreadSignal, signalOf } from './thread-signal.ts'

export const ThreadRpc = RpcGroup.make(
  Rpc.make('CreateThread', {
    payload: { cwd: Schema.UndefinedOr(Schema.String) },
    success: Schema.Struct({ threadId: ThreadId }),
  }),
  Rpc.make('SendMessage', {
    payload: { threadId: ThreadId, text: Schema.String },
    success: Schema.Void,
  }),
  Rpc.make('WatchThread', {
    payload: { threadId: ThreadId },
    success: SessionEvent,
    stream: true,
  }),
  /** What the pane needs to offer a choice: current configuration and the options. */
  Rpc.make('ThreadOptions', {
    payload: { threadId: ThreadId },
    success: ThreadOptions,
  }),
  Rpc.make('ConfigureThread', {
    payload: {
      threadId: ThreadId,
      harness: Schema.UndefinedOr(Schema.NonEmptyString),
      model: Schema.UndefinedOr(Schema.NonEmptyString),
      reasoning: Schema.UndefinedOr(Schema.NonEmptyString),
    },
    success: ThreadOptions,
  }),
  /** Live harness events for the running turn, for a pane that watches it happen. */
  Rpc.make('WatchSignals', {
    payload: { threadId: ThreadId },
    success: ThreadSignal,
    stream: true,
  }),
  Rpc.make('StopThread', { payload: { threadId: ThreadId }, success: Schema.Void }),
  Rpc.make('DiscardThread', { payload: { threadId: ThreadId }, success: Schema.Void }),
  Rpc.make('CompactThread', {
    payload: { threadId: ThreadId, instructions: Schema.UndefinedOr(Schema.String) },
    success: Schema.Void,
  }),
  Rpc.make('ForkThread', {
    payload: { sourceThreadId: ThreadId, cwd: Schema.UndefinedOr(Schema.String) },
    success: Schema.Struct({ threadId: ThreadId }),
  }),
)

const newId = Effect.fnUntraced(function* () {
  const now = yield* Clock.currentTimeMillis
  const n = yield* Random.next
  return `${now.toString(36)}-${n.toString(36).slice(2, 10)}`
})

const healthOf = (harness: HarnessService): Effect.Effect<HarnessChoice['health']> =>
  harness.health === undefined
    ? Effect.succeed(HarnessHealth.make({ status: 'ready' }))
    : harness
        .health()
        .pipe(
          Effect.catch((error) =>
            Effect.succeed(HarnessHealth.make({ status: 'unknown', message: error.message })),
          ),
        )

const harnessChoicesOf = (host: Host): Effect.Effect<readonly HarnessChoice[]> =>
  Effect.gen(function* () {
    const registry = yield* host.service(Harnesses)
    const entries = yield* registry.list()
    const choices: HarnessChoice[] = []
    for (const entry of entries) {
      choices.push({
        id: entry.harness.meta.id,
        label: entry.harness.meta.label,
        health: yield* healthOf(entry.harness),
      })
    }
    return choices
  })

const optionsOf = (
  host: Host,
  threadId: ThreadId,
): Effect.Effect<ThreadOptions, SessionLogError, SessionLog> =>
  Effect.gen(function* () {
    const log = yield* SessionLog
    const registry = yield* host.service(Harnesses)
    const config = foldThreadConfig(yield* log.entries, threadId)
    const harnesses = yield* harnessChoicesOf(host)
    const entry =
      config.harness === undefined
        ? yield* registry.preferred()
        : yield* registry.get(config.harness)
    if (Option.isNone(entry)) {
      // No bridge, no catalogue: the pane still shows the choice it cannot make.
      return { config, harnesses, models: [] }
    }
    const models = yield* entry.value.harness
      .listModels()
      .pipe(Effect.orElseSucceed((): ReadonlyArray<ModelInfo> => []))
    return { config, harnesses, models }
  })

const createThread = (
  host: Host,
  cwd: string | undefined,
): Effect.Effect<{ readonly threadId: ThreadId }, SessionLogError, SessionLog> =>
  Effect.gen(function* () {
    const log = yield* SessionLog
    const entries = yield* log.entries
    let project: string | undefined
    let projectCwd: string | undefined
    for (const event of entries) {
      if (event._tag === 'project/created') {
        project = event.project
        projectCwd = event.cwd
      }
    }
    const directory = cwd ?? projectCwd ?? '.'
    if (project === undefined) {
      project = yield* newId()
      yield* log.write(
        ProjectCreated.make({
          ...unsignedTree,
          id: yield* newId(),
          project,
          name: 'default',
          cwd: directory,
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
  })

export const threadRpcHandlers = (host: Host) => ({
  CreateThread: (payload: { readonly cwd: string | undefined }) =>
    createThread(host, payload.cwd).pipe(Effect.orDie),
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
  ThreadOptions: (payload: { readonly threadId: ThreadId }) =>
    optionsOf(host, payload.threadId).pipe(Effect.orDie),
  ConfigureThread: (payload: {
    readonly threadId: ThreadId
    readonly harness: string | undefined
    readonly model: string | undefined
    readonly reasoning: string | undefined
  }) =>
    Effect.gen(function* () {
      const inference = yield* host.service(Inference)
      yield* inference.configure(payload.threadId, {
        harness: payload.harness,
        model: payload.model,
        reasoning: payload.reasoning,
      })
      return yield* optionsOf(host, payload.threadId)
    }).pipe(Effect.orDie),
  WatchSignals: (payload: { readonly threadId: ThreadId }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const inference = yield* host.service(Inference)
        const signals: Stream.Stream<ThreadSignal> = inference.signals.pipe(
          Stream.filter((signal) => signal.thread === payload.threadId),
          Stream.filterMap((signal) => {
            const line = signalOf(signal.event)
            if (line === undefined) return Result.failVoid
            return Result.succeed(line)
          }),
        )
        return signals
      }).pipe(Effect.orDie),
    ),
  StopThread: (payload: { readonly threadId: ThreadId }) =>
    host.service(Inference).pipe(
      Effect.flatMap((inference) => inference.stop(payload.threadId)),
      Effect.orDie,
    ),
  DiscardThread: (payload: { readonly threadId: ThreadId }) =>
    host.service(Inference).pipe(
      Effect.flatMap((inference) => inference.discard(payload.threadId)),
      Effect.orDie,
    ),
  CompactThread: (payload: {
    readonly threadId: ThreadId
    readonly instructions: string | undefined
  }) =>
    host.service(Inference).pipe(
      Effect.flatMap((inference) => inference.compact(payload.threadId, payload.instructions)),
      Effect.orDie,
    ),
  ForkThread: (payload: { readonly sourceThreadId: ThreadId; readonly cwd: string | undefined }) =>
    Effect.gen(function* () {
      const inference = yield* host.service(Inference)
      const log = yield* SessionLog
      // Without a cwd the fork inherits its source's, which is where the session
      // it resumes was written. `Inference.fork` carries the configuration.
      const created = yield* createThread(
        host,
        payload.cwd ?? foldThreadCwd(yield* log.entries, payload.sourceThreadId),
      )
      yield* inference.fork(
        payload.cwd === undefined
          ? { sourceThreadId: payload.sourceThreadId, targetThreadId: created.threadId }
          : {
              sourceThreadId: payload.sourceThreadId,
              targetThreadId: created.threadId,
              cwd: payload.cwd,
            },
      )
      return created
    }).pipe(Effect.orDie),
})
