import {
  Clock,
  Context,
  Deferred,
  Effect,
  Match,
  Option,
  PubSub,
  Random,
  Ref,
  Result,
  Scope,
  Semaphore,
  Stream,
} from 'effect'
import {
  InboxSpliced,
  MessageAppended,
  ThreadBranched,
  ThreadCompacted,
  ThreadConfigured,
  ToolCompleted,
  ToolRequested,
  TurnFailed,
  TurnStarted,
  compactionCut,
  foldNamedThreads,
  foldThreadConfig,
  foldThreadCwd,
  pathOfLane,
  threadLane,
  unsignedTree,
  type SessionEvent,
  type SessionLogContract,
  type SessionLogError,
  type ThreadConfig,
} from '@oru/kernel'
import * as Items from '@effect-uai/core/Items'
import * as Turn from '@effect-uai/core/Turn'
import {
  HarnessError,
  HarnessHealth,
  explanationOfHealth,
  type HarnessEvent,
  type HarnessForkRequest,
  type HarnessService,
  type HarnessTurnRequest,
  type HarnessesContract,
  type ModelInfo,
  type Mutable,
} from '@oru/harness'
import { demoModelId } from './demo-model.ts'
import { failureReason, historyOf, runTool, toolkitOf } from './seam.ts'
import { foldThread, workOf } from './session-fold.ts'
import type { ToolContribution } from './tool-kind.ts'

/** One live harness event, tagged with the thread it belongs to. */
export interface ThreadSignal {
  readonly thread: string
  readonly event: HarnessEvent
}

/** The configuration a thread change may carry; absent fields are cleared. */
export interface ThreadConfigurationInput {
  readonly harness?: string | undefined
  readonly model?: string | undefined
  readonly reasoning?: string | undefined
}

export interface InferenceContract {
  readonly send: (thread: string, text: string) => Effect.Effect<void, SessionLogError>
  readonly whenIdle: (thread: string) => Effect.Effect<void, SessionLogError>
  /**
   * Continue every lane the log names with work left. Idempotent, and meant to
   * run once the graph is whole, so a restarted host finishes the turns it
   * inherited rather than leaving them parked (ADR-0010).
   */
  readonly resume: () => Effect.Effect<void>
  /**
   * Unified model query. Delegates to the active harness, so a failure is the
   * harness's, not the session log's.
   */
  readonly listModels: () => Effect.Effect<readonly ModelInfo[], HarnessError>
  /**
   * Steering: inject a follow-up prompt.
   * - queue-mode harnesses (oru): appends to history, drains on next loop.
   * - inject-mode harnesses (pi/claude/codex): forwards to `harness.steer`
   *   for mid-turn injection when supported, otherwise falls back to queue.
   */
  readonly steer: (thread: string, text: string) => Effect.Effect<void, SessionLogError>
  /** Interrupt the active turn on a thread, if the harness supports it. */
  readonly abort: (thread: string) => Effect.Effect<void, SessionLogError>
  /** Record which harness, model and reasoning level a thread runs (ADR-0006). */
  readonly configure: (
    thread: string,
    configuration: ThreadConfigurationInput,
  ) => Effect.Effect<void, SessionLogError>
  /** Release a thread's harness session without discarding it. */
  readonly stop: (thread: string) => Effect.Effect<void, SessionLogError | HarnessError>
  /** Release a thread's harness session and delete what it kept. */
  readonly discard: (thread: string) => Effect.Effect<void, SessionLogError | HarnessError>
  /**
   * Fork a thread's conversation into a new thread. The new lane records the
   * entry it continues from, so its memory is reprojected from the log; the
   * active harness is asked to copy its own session only when it can.
   */
  readonly fork: (
    request: HarnessForkRequest,
  ) => Effect.Effect<void, SessionLogError | HarnessError>
  /** Compact a thread's harness session and record the view the log keeps. */
  readonly compact: (
    thread: string,
    instructions?: string,
  ) => Effect.Effect<void, SessionLogError | HarnessError>
  /** Live harness events, for a view that wants to watch a turn happen. */
  readonly signals: Stream.Stream<ThreadSignal>
}

export class Inference extends Context.Service<Inference, InferenceContract>()('oru/inference') {}

const newId = Effect.fnUntraced(function* () {
  const now = yield* Clock.currentTimeMillis
  const n = yield* Random.next
  return `${now.toString(36)}-${n.toString(36).slice(2, 10)}`
})

interface CollectedTurn {
  readonly turn: Option.Option<Turn.Turn>
  readonly compactions: readonly {
    readonly automatic: boolean
    readonly summary: string
    readonly tokensBefore: number
    readonly readFiles: readonly string[]
    readonly modifiedFiles: readonly string[]
  }[]
  readonly toolResults: ReadonlyMap<string, { readonly ok: boolean; readonly result: string }>
}

/**
 * Drain a harness turn into a plain value.
 *
 * A harness reports; the runtime records. So this collects the assembled turn
 * and the lifecycle facts that have a home in the log, and leaves the rest as
 * events a view may watch.
 */
const collectTurn = (
  stream: Stream.Stream<HarnessEvent, HarnessError>,
): Effect.Effect<CollectedTurn, HarnessError> =>
  Effect.gen(function* () {
    const turn = yield* Ref.make(Option.none<Turn.Turn>())
    const compactions = yield* Ref.make<CollectedTurn['compactions']>([])
    const toolResults = yield* Ref.make(new Map<string, { ok: boolean; result: string }>())
    yield* stream.pipe(
      Stream.runForEach((event) =>
        Match.value(event).pipe(
          Match.tag('TurnComplete', (event) => Ref.set(turn, Option.some(event.turn))),
          Match.tag('CompactionEnded', (event) =>
            Ref.update(compactions, (list) => [
              ...list,
              {
                automatic: event.automatic,
                summary: event.summary,
                tokensBefore: event.tokensBefore,
                readFiles: event.readFiles,
                modifiedFiles: event.modifiedFiles,
              },
            ]),
          ),
          Match.tag('ToolResult', (event) =>
            Ref.update(toolResults, (map) =>
              new Map(map).set(event.call_id, { ok: event.ok, result: event.result }),
            ),
          ),
          // Every other lifecycle fact has no home in the log, and the streaming
          // deltas were already watched live: keep only what gets recorded
          // (ADR-0006).
          Match.orElse(() => Effect.void),
        ),
      ),
    )
    return {
      turn: yield* Ref.get(turn),
      compactions: yield* Ref.get(compactions),
      toolResults: yield* Ref.get(toolResults),
    }
  })

const toolResultsOf = (turn: Turn.Turn): ReadonlyMap<string, string> => {
  const outputs = new Map<string, string>()
  for (const item of turn.items) {
    if (Items.isToolCallOutput(item)) outputs.set(item.call_id, item.output)
  }
  return outputs
}

const persistTurn = (
  log: SessionLogContract,
  thread: string,
  turn: string,
  assembled: Turn.Turn,
  harnessToolResults: ReadonlyMap<string, { readonly ok: boolean; readonly result: string }>,
  prompt: string | undefined,
): Effect.Effect<void, SessionLogError> =>
  Effect.gen(function* () {
    let text = ''
    let promptWritten = prompt === undefined
    const flush = Effect.fnUntraced(function* () {
      if (text === '') return
      const body = text
      text = ''
      yield* log.write(
        MessageAppended.make({
          ...unsignedTree,
          id: yield* newId(),
          thread,
          role: 'assistant',
          body,
        }),
      )
    })
    const outputs = toolResultsOf(assembled)
    for (const item of assembled.items) {
      if (Items.isMessage(item) && item.role === 'user') {
        yield* flush()
        const body = item.content
          .map((block) => (block.type === 'input_text' ? block.text : ''))
          .join('')
        // The prompt is already in the log; this user message is one the
        // harness injected mid-turn, and only the harness knows about it.
        if (!promptWritten && body === prompt) {
          promptWritten = true
          continue
        }
        if (body !== '') {
          yield* log.write(
            MessageAppended.make({
              ...unsignedTree,
              id: yield* newId(),
              thread,
              role: 'user',
              body,
            }),
          )
        }
        continue
      }
      if (Items.isToolCall(item)) {
        yield* flush()
        yield* log.write(
          ToolRequested.make({
            ...unsignedTree,
            id: yield* newId(),
            thread,
            turn,
            call: item.call_id,
            name: item.name,
            arguments: item.arguments,
          }),
        )
        const output = outputs.get(item.call_id)
        if (output === undefined) continue
        // Paired in the same turn: the harness ran this tool itself, so the
        // result is a fact rather than work left for the runtime (ADR-0007).
        const reported = harnessToolResults.get(item.call_id)
        yield* log.write(
          ToolCompleted.make({
            ...unsignedTree,
            id: yield* newId(),
            thread,
            turn,
            call: item.call_id,
            name: item.name,
            ok: reported?.ok ?? true,
            result: output,
          }),
        )
        continue
      }
      if (Items.isMessage(item) && item.role === 'assistant') {
        for (const block of item.content) {
          if (Items.isOutputText(block)) text += block.text
        }
      }
    }
    yield* flush()
  })

export const openInference = (
  log: SessionLogContract,
  harnesses: HarnessesContract,
  loadTools: Effect.Effect<readonly ToolContribution[]>,
  scope: Scope.Scope,
): Effect.Effect<InferenceContract> =>
  Effect.gen(function* () {
    const lock = Semaphore.makeUnsafe(1)
    const idle = new Map<string, Deferred.Deferred<void>>()
    const signals = yield* PubSub.unbounded<ThreadSignal>()

    const resolveHarness = (
      configuration: ThreadConfig,
    ): Effect.Effect<HarnessService | undefined> =>
      Effect.gen(function* () {
        const configured =
          configuration.harness === undefined
            ? yield* harnesses.preferred()
            : yield* harnesses.get(configuration.harness)
        return Option.match(configured, {
          onNone: () => undefined,
          onSome: (entry) => entry.harness,
        })
      })

    const lastEventIdOf = (events: readonly SessionEvent[], thread: string): string | undefined =>
      pathOfLane(events, threadLane(thread)).at(-1)?.id

    const recordCompactions = (
      thread: string,
      events: readonly SessionEvent[],
      collected: CollectedTurn,
    ): Effect.Effect<void, SessionLogError> =>
      Effect.gen(function* () {
        for (const compaction of collected.compactions) {
          const firstKeptEntryId = compactionCut(events, thread) ?? (yield* newId())
          yield* log.write(
            ThreadCompacted.make({
              ...unsignedTree,
              id: yield* newId(),
              thread,
              summary: compaction.summary,
              firstKeptEntryId,
              tokensBefore: compaction.tokensBefore,
              readFiles: compaction.readFiles,
              modifiedFiles: compaction.modifiedFiles,
            }),
          )
        }
      })

    const drain = Effect.fnUntraced(function* (thread: string) {
      for (;;) {
        const events = yield* log.entries
        const work = workOf(foldThread(events, thread))
        if (work._tag === 'Idle') return
        if (work._tag === 'RunTool') {
          const work_ = work
          const tools = yield* loadTools
          const result = yield* runTool(tools, work_.pending)
          yield* log.write(
            ToolCompleted.make({
              ...unsignedTree,
              id: yield* newId(),
              thread,
              turn: work_.pending.turn,
              call: work_.pending.call,
              name: work_.pending.name,
              ok: result.ok,
              result: result.result,
            }),
          )
          continue
        }

        const turn = work.turn ?? (yield* newId())
        if (work.turn === undefined) {
          yield* log.write(TurnStarted.make({ ...unsignedTree, id: yield* newId(), thread, turn }))
        }
        const configuration = foldThreadConfig(events, thread)
        const harness = yield* resolveHarness(configuration)
        if (harness === undefined) {
          yield* log.write(
            TurnFailed.make({
              ...unsignedTree,
              id: yield* newId(),
              thread,
              turn,
              reason:
                configuration.harness === undefined
                  ? 'no harness is active on this host'
                  : `no harness named "${configuration.harness}" is active`,
            }),
          )
          continue
        }

        const health =
          harness.health === undefined
            ? HarnessHealth.make({ status: 'ready' })
            : yield* harness
                .health()
                .pipe(
                  Effect.catch((error) =>
                    Effect.succeed(
                      HarnessHealth.make({ status: 'unknown', message: error.message }),
                    ),
                  ),
                )
        if (health.status !== 'ready') {
          yield* log.write(
            TurnFailed.make({
              ...unsignedTree,
              id: yield* newId(),
              thread,
              turn,
              reason: explanationOfHealth(health),
            }),
          )
          continue
        }

        const history = historyOf(events, thread)
        const tools = yield* loadTools
        const toolkit = tools.length === 0 ? undefined : toolkitOf(tools)
        const models = yield* harness.listModels().pipe(Effect.orElseSucceed(() => []))
        const model = configuration.model ?? defaultModelOf(models)
        const cwd = foldThreadCwd(events, thread)
        // Absent is not the same as undefined for the harness contract, so each
        // member is added only when the thread actually carries it.
        const request: Mutable<HarnessTurnRequest> = { threadId: thread, history, model }
        if (toolkit !== undefined) request.tools = toolkit
        if (cwd !== undefined) request.cwd = cwd
        if (configuration.reasoning !== undefined) request.reasoning = configuration.reasoning
        const collected = yield* harness.streamTurn(request).pipe(
          Stream.tap((event) => PubSub.publish(signals, { thread, event })),
          collectTurn,
          Effect.result,
        )
        if (Result.isFailure(collected)) {
          yield* log.write(
            TurnFailed.make({
              ...unsignedTree,
              id: yield* newId(),
              thread,
              turn,
              reason: failureReason(collected.failure),
            }),
          )
          continue
        }
        const assembled = collected.success
        yield* recordCompactions(thread, events, assembled)
        if (Option.isNone(assembled.turn)) {
          yield* log.write(
            TurnFailed.make({
              ...unsignedTree,
              id: yield* newId(),
              thread,
              turn,
              reason: 'the harness ended the turn without reporting one',
            }),
          )
          continue
        }
        const prompt = lastUserText(history)
        if (assembled.turn.value.items.length === 0) {
          // Nothing came back, so the thread would ask the same harness the same
          // question forever. Failing it settles the thread instead.
          yield* log.write(
            TurnFailed.make({
              ...unsignedTree,
              id: yield* newId(),
              thread,
              turn,
              reason: 'the harness reported an empty turn',
            }),
          )
          continue
        }
        yield* persistTurn(log, thread, turn, assembled.turn.value, assembled.toolResults, prompt)
      }
    })

    const kick = (thread: string) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (idle.has(thread)) return
          const done = yield* Deferred.make<void>()
          idle.set(thread, done)
          yield* drain(thread).pipe(
            Effect.ensuring(
              Deferred.succeed(done, undefined).pipe(
                Effect.andThen(Effect.sync(() => idle.delete(thread))),
              ),
            ),
            Effect.forkIn(scope),
          )
        }),
      )

    /**
     * Continue the lanes a restarted host finds with work left: the fold, not a
     * snapshot, is what says which threads were running (ADR-0010).
     */
    const resume = Effect.gen(function* () {
      const entries = yield* log.entries
      for (const thread of foldNamedThreads(entries)) {
        if (workOf(foldThread(entries, thread))._tag === 'Idle') continue
        yield* kick(thread)
      }
    })

    const queueSteer = (thread: string, text: string) =>
      Effect.gen(function* () {
        yield* log.write(
          MessageAppended.make({
            ...unsignedTree,
            id: yield* newId(),
            thread,
            role: 'user',
            body: text,
          }),
        )
        yield* log.write(
          InboxSpliced.make({
            ...unsignedTree,
            id: yield* newId(),
            thread,
            queue: 'next-turn',
            body: text,
          }),
        )
        yield* kick(thread)
      })

    return {
      signals: Stream.fromPubSub(signals),
      send: (thread, text) => queueSteer(thread, text),
      resume: () => resume.pipe(Effect.orDie),
      whenIdle: (thread) =>
        Effect.gen(function* () {
          const done = idle.get(thread)
          if (done === undefined) return
          yield* Deferred.await(done)
        }),
      listModels: () =>
        Effect.gen(function* () {
          const preferred = yield* harnesses.preferred()
          if (Option.isNone(preferred)) return []
          return yield* preferred.value.harness.listModels()
        }),
      steer: (thread, text) =>
        Effect.gen(function* () {
          const events = yield* log.entries
          const harness = yield* resolveHarness(foldThreadConfig(events, thread))
          // Prefer harness-native inject steering when the capability is present.
          // An injected message becomes a fact when the harness reports the turn
          // it went into, so this path records nothing itself; queueing below
          // records it here, because no harness will.
          if (
            harness !== undefined &&
            harness.capabilities.steering === 'inject' &&
            harness.steer !== undefined
          ) {
            const injected = yield* harness.steer(thread, text).pipe(Effect.result)
            if (Result.isSuccess(injected)) return
            // Fall back to queue mode on harness-level failure.
          }
          yield* queueSteer(thread, text)
        }),
      abort: (thread) =>
        Effect.gen(function* () {
          const events = yield* log.entries
          const harness = yield* resolveHarness(foldThreadConfig(events, thread))
          if (harness?.abort === undefined) return
          yield* harness.abort(thread).pipe(Effect.orElseSucceed(() => undefined))
        }),
      configure: (thread, configuration) =>
        Effect.gen(function* () {
          const events = yield* log.entries
          const current = foldThreadConfig(events, thread)
          const next = {
            harness: merged(configuration, 'harness', current.harness),
            model: merged(configuration, 'model', current.model),
            reasoning: merged(configuration, 'reasoning', current.reasoning),
          }
          yield* log.write(
            ThreadConfigured.make({
              ...unsignedTree,
              id: yield* newId(),
              thread,
              harness: next.harness,
              model: next.model,
              reasoning: next.reasoning,
            }),
          )
        }),
      stop: (thread) =>
        Effect.gen(function* () {
          const events = yield* log.entries
          const harness = yield* resolveHarness(foldThreadConfig(events, thread))
          if (harness?.stop === undefined) return
          yield* harness.stop(thread)
        }),
      discard: (thread) =>
        Effect.gen(function* () {
          const events = yield* log.entries
          const harness = yield* resolveHarness(foldThreadConfig(events, thread))
          if (harness?.discard === undefined) return
          yield* harness.discard(thread)
        }),
      fork: (request) =>
        Effect.gen(function* () {
          const events = yield* log.entries
          const fromId = lastEventIdOf(events, request.sourceThreadId)
          // The fork runs as its source did until someone says otherwise.
          const config = foldThreadConfig(events, request.sourceThreadId)
          yield* log.write(
            ThreadConfigured.make({
              ...unsignedTree,
              id: yield* newId(),
              thread: request.targetThreadId,
              harness: config.harness,
              model: config.model,
              reasoning: config.reasoning,
            }),
          )
          // The lane is oru's: the fork reaches back to the entry it continues
          // from whether or not the harness can copy a session of its own.
          if (fromId !== undefined) {
            yield* log.write(
              ThreadBranched.make({
                ...unsignedTree,
                id: yield* newId(),
                thread: request.targetThreadId,
                fromId,
                summary: undefined,
              }),
            )
          }
          const harness = yield* resolveHarness(config)
          if (harness?.fork === undefined) return
          yield* harness.fork(request)
        }),
      compact: (thread, instructions) =>
        Effect.gen(function* () {
          const events = yield* log.entries
          const harness = yield* resolveHarness(foldThreadConfig(events, thread))
          if (harness?.compact === undefined) {
            return yield* Effect.fail(
              new HarnessError({
                message: 'the active harness cannot compact a thread',
                code: 'unsupported_operation',
              }),
            )
          }
          const compaction = yield* harness.compact(
            instructions === undefined ? { threadId: thread } : { threadId: thread, instructions },
          )
          yield* log.write(
            ThreadCompacted.make({
              ...unsignedTree,
              id: yield* newId(),
              thread,
              summary: compaction.summary,
              firstKeptEntryId: compactionCut(events, thread) ?? (yield* newId()),
              tokensBefore: compaction.tokensBefore,
              readFiles: compaction.readFiles,
              modifiedFiles: compaction.modifiedFiles,
            }),
          )
        }),
    }
  })

/** A change updates what it names and leaves the rest as it was. */
const merged = <K extends keyof ThreadConfigurationInput>(
  input: ThreadConfigurationInput,
  key: K,
  current: string | undefined,
): string | undefined => (key in input ? input[key] : current)

const defaultModelOf = (models: readonly ModelInfo[]): string => {
  // Keep `mock` first when the catalogue lists it, so existing tests stay stable.
  const demo = models.find((model) => model.id === demoModelId)
  if (demo !== undefined) return demo.id
  const preferred = models.find((model) => model.isDefault === true)
  return preferred?.id ?? models[0]?.id ?? demoModelId
}

const lastUserText = (history: readonly Items.HistoryItem[]): string | undefined => {
  for (let index = history.length - 1; index >= 0; index--) {
    const item = history[index]
    if (item === undefined) continue
    if (!Items.isMessage(item) || item.role !== 'user') continue
    const text = item.content
      .map((block) => (block.type === 'input_text' ? block.text : ''))
      .join('')
    if (text !== '') return text
  }
  return undefined
}
