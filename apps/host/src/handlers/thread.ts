import { Effect, Option, Predicate, Result, Schema, Stream } from 'effect'
import {
  HarnessHealth,
  Harnesses,
  type HarnessService,
  type ModelInfo,
  type Mutable,
  type ProviderInfo,
} from '@oru/harness'
import {
  MessageAppended,
  SessionLog,
  ThreadCreated,
  UnknownProject,
  UnknownThread,
  foldNamedThreads,
  foldProject,
  foldThreadConfig,
  foldThreadCwd,
  modelVisiblePath,
  newId,
  threadOf,
  unsignedTree,
  type Host,
  type NamedProject,
  type ProjectId,
  type ProviderUnavailable,
  type SessionLogError,
  type ThreadId,
} from '@oru/kernel'
import { Runtime } from '@oru/harness'
import {
  CompactFailed,
  HarnessChoice,
  ThreadOptions,
  signalOf,
  type ThreadConfiguration,
  type ThreadSignal,
} from '@oru/rpc'

/**
 * What a thread call keeps on its failure channel: the refusals the pane
 * renders, and a host that is not providing the service the call needs.
 * Everything else stays a defect (ADR-0013).
 */
const keepThreadError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catch((error) =>
      Predicate.isTagged(error, 'UnknownProject') ||
      Predicate.isTagged(error, 'UnknownThread') ||
      Predicate.isTagged(error, 'ProviderUnavailable')
        ? Effect.fail(error)
        : Effect.die(error),
    ),
  )

/**
 * The same rule for a call whose contract declares only the missing-provider
 * state: `host.service` fails typed, and `orDie` here would put the defect
 * back on the wire where the client renders a crash instead of a state.
 */
const keepUnavailable = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catch((error) =>
      Predicate.isTagged(error, 'ProviderUnavailable') ? Effect.fail(error) : Effect.die(error),
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

const invalidateHealthOf = (host: Host): Effect.Effect<void, ProviderUnavailable> =>
  Effect.gen(function* () {
    const registry = yield* host.service(Harnesses)
    for (const entry of yield* registry.list()) {
      if (entry.harness.invalidateHealth !== undefined) {
        yield* entry.harness.invalidateHealth()
      }
    }
  })

const harnessChoicesOf = (
  host: Host,
): Effect.Effect<readonly HarnessChoice[], ProviderUnavailable> =>
  Effect.gen(function* () {
    const registry = yield* host.service(Harnesses)
    const entries = yield* registry.list()
    const choices: HarnessChoice[] = []
    for (const entry of entries) {
      // Absent stays absent: the choice carries the harness's glyph only
      // when the harness names one.
      const choice: Mutable<HarnessChoice> = {
        id: entry.harness.meta.id,
        label: entry.harness.meta.label,
        health: yield* healthOf(entry.harness),
      }
      const icon = entry.harness.meta.icon
      if (icon !== undefined) choice.icon = icon
      choices.push(choice)
    }
    return choices
  })

const optionsOf = (
  host: Host,
  threadId: ThreadId | undefined,
): Effect.Effect<ThreadOptions, ProviderUnavailable | SessionLogError, SessionLog> =>
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
      return { config, harness: undefined, harnesses, providers: [], models: [] }
    }
    const harness = entry.value.harness
    const models = yield* harness
      .listModels()
      .pipe(Effect.orElseSucceed((): ReadonlyArray<ModelInfo> => []))
    const providers = yield* harness.providers === undefined
      ? Effect.succeed<ReadonlyArray<ProviderInfo>>([])
      : harness.providers().pipe(Effect.orElseSucceed((): ReadonlyArray<ProviderInfo> => []))
    return { config, harness: harness.meta.id, harnesses, providers, models }
  })

const hasConfiguration = (input: ThreadConfiguration): boolean =>
  input.harness !== undefined || input.model !== undefined || input.reasoning !== undefined

const titleOf = (events: Parameters<typeof modelVisiblePath>[0], thread: ThreadId): string => {
  for (const event of modelVisiblePath(events, thread)) {
    if (Schema.is(MessageAppended)(event) && event.role === 'user' && event.body.trim() !== '') {
      const line = event.body.trim().split('\n')[0] ?? ''
      return line.length > 80 ? `${line.slice(0, 80)}…` : line
    }
  }
  return thread.slice(0, 8)
}

const createThread = (
  host: Host,
  project: ProjectId,
  configuration: ThreadConfiguration,
  cwd?: string,
): Effect.Effect<
  { readonly threadId: ThreadId; readonly project: NamedProject },
  ProviderUnavailable | SessionLogError | UnknownProject,
  SessionLog
> =>
  Effect.gen(function* () {
    const log = yield* SessionLog
    const named = foldProject(yield* log.entries, project)
    if (named === undefined) {
      return yield* new UnknownProject({ project })
    }
    const threadId = yield* newId()
    if (cwd === undefined) {
      yield* log.write(
        ThreadCreated.make({
          ...unsignedTree,
          id: yield* newId(),
          thread: threadId,
          project: named.id,
        }),
      )
    } else {
      yield* log.write(
        ThreadCreated.make({
          ...unsignedTree,
          id: yield* newId(),
          thread: threadId,
          project: named.id,
          cwd,
        }),
      )
    }
    // The configuration lands on the created thread's own lane, before any
    // turn, so there is no window where the thread runs unconfigured.
    if (hasConfiguration(configuration)) {
      const runtime = yield* host.service(Runtime)
      yield* runtime.configure(threadId, {
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
    readonly cwd?: string | undefined
  }) =>
    keepThreadError(
      createThread(
        host,
        payload.project,
        {
          harness: payload.harness,
          model: payload.model,
          reasoning: payload.reasoning,
        },
        payload.cwd,
      ),
    ),
  ListThreads: (payload: { readonly project?: ProjectId | undefined }) =>
    Effect.gen(function* () {
      const log = yield* SessionLog
      const entries = yield* log.entries
      const threads = [...foldNamedThreads(entries)]
      const summaries = []
      for (const thread of threads) {
        let project: ProjectId | undefined
        let updatedAt = 0
        for (const event of entries) {
          if (threadOf(event) !== thread) continue
          if (Schema.is(ThreadCreated)(event)) project = event.project
          if (event.timestamp > updatedAt) updatedAt = event.timestamp
        }
        if (project === undefined) continue
        if (payload.project !== undefined && project !== payload.project) continue
        summaries.push({
          thread,
          project,
          title: titleOf(entries, thread),
          updatedAt,
          cwd: foldThreadCwd(entries, thread),
        })
      }
      summaries.sort((left, right) => right.updatedAt - left.updatedAt)
      return summaries
    }).pipe(Effect.orDie),
  WaitThread: (payload: { readonly threadId: ThreadId }) =>
    host.service(Runtime).pipe(
      Effect.flatMap((runtime) => runtime.whenIdle(payload.threadId)),
      keepUnavailable,
    ),
  SendMessage: (payload: { readonly threadId: ThreadId; readonly text: string }) =>
    host.service(Runtime).pipe(
      Effect.flatMap((runtime) => runtime.send(payload.threadId, payload.text)),
      keepUnavailable,
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
    }).pipe(keepUnavailable),
  ConfigureThread: (payload: {
    readonly threadId: ThreadId
    readonly harness: string | undefined
    readonly model: string | undefined
    readonly reasoning: string | undefined
  }) =>
    Effect.gen(function* () {
      const runtime = yield* host.service(Runtime)
      yield* runtime.configure(payload.threadId, {
        harness: payload.harness,
        model: payload.model,
        reasoning: payload.reasoning,
      })
      return yield* optionsOf(host, payload.threadId)
    }).pipe(keepUnavailable),
  WatchSignals: (payload: { readonly threadId: ThreadId }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const runtime = yield* host.service(Runtime)
        const signals: Stream.Stream<ThreadSignal> = runtime.signals.pipe(
          Stream.filter((signal) => signal.thread === payload.threadId),
          Stream.filterMap((signal) => {
            const line = signalOf(signal.event)
            if (line === undefined) return Result.failVoid
            return Result.succeed(line)
          }),
        )
        return signals
      }).pipe(keepUnavailable),
    ),
  StopThread: (payload: { readonly threadId: ThreadId }) =>
    host.service(Runtime).pipe(
      Effect.flatMap((runtime) => runtime.stop(payload.threadId)),
      keepUnavailable,
    ),
  DiscardThread: (payload: { readonly threadId: ThreadId }) =>
    host.service(Runtime).pipe(
      Effect.flatMap((runtime) => runtime.discard(payload.threadId)),
      Effect.andThen(host.closeThread(payload.threadId)),
      keepUnavailable,
    ),
  CompactThread: (payload: {
    readonly threadId: ThreadId
    readonly instructions: string | undefined
  }) =>
    host.service(Runtime).pipe(
      Effect.flatMap((runtime) => runtime.compact(payload.threadId, payload.instructions)),
      Effect.catchTags(
        {
          HarnessError: (error) =>
            Effect.fail(new CompactFailed({ thread: payload.threadId, reason: error.message })),
          ProviderUnavailable: (error) => Effect.fail(error),
        },
        (error) => Effect.die(error),
      ),
    ),
  ForkThread: (payload: { readonly sourceThreadId: ThreadId; readonly cwd: string | undefined }) =>
    keepThreadError(
      Effect.gen(function* () {
        const runtime = yield* host.service(Runtime)
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
        const created = yield* createThread(host, project, {}, payload.cwd)
        yield* runtime.fork(
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
    host.service(Runtime).pipe(
      Effect.flatMap((runtime) =>
        runtime.decide(payload.threadId, payload.request, payload.decision),
      ),
      keepUnavailable,
    ),
})
