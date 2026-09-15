import { Clock, Effect, Option, Random, Result, Stream } from 'effect'
import { HarnessHealth, Harnesses, type HarnessService, type ModelInfo } from '@oru/harness'
import {
  SessionLog,
  ThreadCreated,
  foldProject,
  foldThreadConfig,
  threadOf,
  unsignedTree,
  type Host,
  type NamedProject,
  type ProjectId,
  type SessionLogError,
  type ThreadId,
} from '@oru/kernel'
import { Inference } from '@oru/inference'
import { HarnessChoice, ThreadOptions, signalOf, type ThreadSignal } from '@oru/rpc'

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
  project: ProjectId,
): Effect.Effect<
  { readonly threadId: ThreadId; readonly project: NamedProject },
  SessionLogError,
  SessionLog
> =>
  Effect.gen(function* () {
    const log = yield* SessionLog
    const named = foldProject(yield* log.entries, project)
    if (named === undefined) {
      return yield* Effect.die(new Error(`unknown project ${project}`))
    }
    const threadId = yield* newId()
    yield* log.write(
      ThreadCreated.make({
        ...unsignedTree,
        id: yield* newId(),
        thread: threadId,
        project: named.id,
      }),
    )
    return { threadId, project: named }
  })

export const threadRpcHandlers = (host: Host) => ({
  CreateThread: (payload: { readonly project: ProjectId }) =>
    createThread(payload.project).pipe(Effect.orDie),
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
      const entries = yield* log.entries
      let project: ProjectId | undefined
      for (const event of entries) {
        if (event._tag === 'thread/created' && event.thread === payload.sourceThreadId) {
          project = event.project
        }
      }
      if (project === undefined) {
        return yield* Effect.die(new Error(`unknown source thread ${payload.sourceThreadId}`))
      }
      const created = yield* createThread(project)
      yield* inference.fork(
        payload.cwd === undefined
          ? { sourceThreadId: payload.sourceThreadId, targetThreadId: created.threadId }
          : {
              sourceThreadId: payload.sourceThreadId,
              targetThreadId: created.threadId,
              cwd: payload.cwd,
            },
      )
      return { threadId: created.threadId }
    }).pipe(Effect.orDie),
})
