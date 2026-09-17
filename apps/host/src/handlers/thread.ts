import { Effect, Option, Predicate, Result, Schema, Stream } from 'effect'
import { HarnessHealth, Harnesses, type HarnessService, type ModelInfo } from '@oru/harness'
import {
  SessionLog,
  ThreadCreated,
  UnknownProject,
  UnknownThread,
  foldProject,
  foldThreadConfig,
  newId,
  threadOf,
  unsignedTree,
  type Host,
  type NamedProject,
  type ProjectId,
  type SessionLogError,
  type ThreadId,
} from '@oru/kernel'
import { Inference } from '@oru/inference'
import {
  HarnessChoice,
  ThreadOptions,
  signalOf,
  type ThreadConfiguration,
  type ThreadSignal,
} from '@oru/rpc'

const keepThreadError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catch((error) =>
      Predicate.isTagged(error, 'UnknownProject') || Predicate.isTagged(error, 'UnknownThread')
        ? Effect.fail(error)
        : Effect.die(error),
    ),
  )

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

const invalidateHealthOf = (host: Host): Effect.Effect<void> =>
  Effect.gen(function* () {
    const registry = yield* host.service(Harnesses)
    for (const entry of yield* registry.list()) {
      if (entry.harness.invalidateHealth !== undefined) {
        yield* entry.harness.invalidateHealth()
      }
    }
  })

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
  threadId: ThreadId | undefined,
): Effect.Effect<ThreadOptions, SessionLogError, SessionLog> =>
  Effect.gen(function* () {
    const log = yield* SessionLog
    const registry = yield* host.service(Harnesses)
    // A thread that does not exist yet has no facts, so an absent id reads as an
    // unconfigured thread and the answer is the host's defaults.
    const config =
      threadId === undefined
        ? { harness: undefined, model: undefined, reasoning: undefined }
        : foldThreadConfig(yield* log.entries, threadId)
    const harnesses = yield* harnessChoicesOf(host)
    const entry =
      config.harness === undefined
        ? yield* registry.preferred()
        : yield* registry.get(config.harness)
    if (Option.isNone(entry)) {
      // No bridge, no catalogue: the pane still shows the choice it cannot make.
      return { config, harness: undefined, harnesses, models: [] }
    }
    const models = yield* entry.value.harness
      .listModels()
      .pipe(Effect.orElseSucceed((): ReadonlyArray<ModelInfo> => []))
    return { config, harness: entry.value.harness.meta.id, harnesses, models }
  })

const hasConfiguration = (input: ThreadConfiguration): boolean =>
  input.harness !== undefined || input.model !== undefined || input.reasoning !== undefined

const createThread = (
  host: Host,
  project: ProjectId,
  configuration: ThreadConfiguration,
): Effect.Effect<
  { readonly threadId: ThreadId; readonly project: NamedProject },
  SessionLogError | UnknownProject,
  SessionLog
> =>
  Effect.gen(function* () {
    const log = yield* SessionLog
    const named = foldProject(yield* log.entries, project)
    if (named === undefined) {
      return yield* new UnknownProject({ project })
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
    // The configuration lands on the created thread's own lane, before any
    // turn, so there is no window where the thread runs unconfigured.
    if (hasConfiguration(configuration)) {
      const inference = yield* host.service(Inference)
      yield* inference.configure(threadId, {
        harness: configuration.harness,
        model: configuration.model,
        reasoning: configuration.reasoning,
      })
    }
    yield* host.openThread(threadId).pipe(Effect.orDie)
    return { threadId, project: named }
  })

export const threadRpcHandlers = (host: Host) => ({
  CreateThread: (payload: {
    readonly project: ProjectId
    readonly harness: string | undefined
    readonly model: string | undefined
    readonly reasoning: string | undefined
  }) =>
    keepThreadError(
      createThread(host, payload.project, {
        harness: payload.harness,
        model: payload.model,
        reasoning: payload.reasoning,
      }),
    ),
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
  ThreadOptions: (payload: {
    readonly threadId: ThreadId | undefined
    readonly refresh?: boolean
  }) =>
    Effect.gen(function* () {
      if (payload.refresh === true) yield* invalidateHealthOf(host)
      return yield* optionsOf(host, payload.threadId)
    }).pipe(Effect.orDie),
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
      Effect.andThen(host.closeThread(payload.threadId)),
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
    keepThreadError(
      Effect.gen(function* () {
        const inference = yield* host.service(Inference)
        const log = yield* SessionLog
        const entries = yield* log.entries
        let project: ProjectId | undefined
        for (const event of entries) {
          if (Schema.is(ThreadCreated)(event) && event.thread === payload.sourceThreadId) {
            project = event.project
          }
        }
        if (project === undefined) {
          return yield* new UnknownThread({ thread: payload.sourceThreadId })
        }
        const created = yield* createThread(host, project, {})
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
      }),
    ),
  DecideApproval: (payload: {
    readonly threadId: ThreadId
    readonly request: string
    readonly decision: 'approve' | 'deny'
  }) =>
    host.service(Inference).pipe(
      Effect.flatMap((inference) =>
        inference.decide(payload.threadId, payload.request, payload.decision),
      ),
      Effect.orDie,
    ),
})
