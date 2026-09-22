import { Cause, Deferred, Effect, Queue, Stream } from 'effect'
import { SessionMessage } from '@opencode/schema/session-message'
import {
  HarnessEvent,
  type AssembledTurn,
  type HarnessError,
  type HarnessTurnRequest,
  type Mutable,
} from '@oru/harness'
import { assembleTurn, promptMessageIndex } from './assemble.ts'
import type { OpenCodeCatalog } from './catalog.ts'
import { aborted, executionFailed, noActiveTurn } from './errors.ts'
import type { OpenCodePort } from './port.ts'
import { ensureSession, syncDirectory, syncInstructions, syncModel } from './sessions.ts'
import { TurnTranslator } from './translate.ts'

/**
 * One turn, driven from OpenCode's own record.
 *
 * Setup (resolve model, seed-or-open the session, sync directory, model,
 * instructions, and tools) runs when the stream starts; the bus and the
 * durable log are both consumed by fibers forked *before* `session.prompt`
 * admits the prompt, so no delta or fact predates a subscriber. Facts come
 * from the log, deltas from the bus, and the turn assembles from a `message.list`
 * slice after the durable terminal — the stream emits `TurnComplete` exactly
 * once, last, or fails with the contract's own error.
 */

/** What a proxy tool call needs after OpenCode dispatches it. */
export interface BoundTurn {
  readonly executeTool: NonNullable<HarnessTurnRequest['executeTool']>
  readonly awaitToolApproval: HarnessTurnRequest['awaitToolApproval']
  readonly toolNames: ReadonlySet<string>
}

export interface TurnHost {
  readonly port: OpenCodePort
  readonly catalog: OpenCodeCatalog
  readonly cursors: Map<string, number | undefined>
  readonly active: Map<string, { readonly promptMessageID: string }>
  readonly bound: Map<string, BoundTurn>
  readonly syncTools: (tools: HarnessTurnRequest['tools']) => Effect.Effect<void, HarnessError>
}

export const runTurn = (
  host: TurnHost,
  request: HarnessTurnRequest,
): Stream.Stream<HarnessEvent, HarnessError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const { port, catalog, cursors, active, bound } = host
      const threadId = request.threadId
      const cwd = request.cwd ?? process.cwd()
      const ref =
        request.model === undefined
          ? yield* catalog.defaultRef()
          : yield* catalog.resolveRef(request.model)
      const ensured = yield* ensureSession(port, {
        threadId,
        cwd,
        history: request.history,
        model: ref,
      })
      yield* syncDirectory(port, ensured.info, cwd)
      yield* syncModel(port, ensured.info, ref)
      yield* syncInstructions(port, threadId, request.instructions)
      yield* host.syncTools(request.tools)
      bound.set(ensured.info.id, {
        executeTool:
          request.executeTool ??
          (() => Promise.resolve({ ok: false as const, result: 'no tool executor was bound' })),
        awaitToolApproval: request.awaitToolApproval,
        toolNames: new Set((request.tools ?? []).map((tool) => tool.name)),
      })
      const promptMessageID = SessionMessage.ID.create()
      active.set(threadId, { promptMessageID })
      const translator = new TurnTranslator()
      const sessionID = ensured.info.id
      return Stream.callback<HarnessEvent, HarnessError>((queue) =>
        Effect.gen(function* () {
          const offer = (events: readonly HarnessEvent[]): Effect.Effect<void> =>
            Effect.forEach(events, (event) => Queue.offer(queue, event), { discard: true })
          if (
            request.history.some(
              (item) => item.type === 'user_message' && (item.images?.length ?? 0) > 0,
            )
          ) {
            yield* offer([
              HarnessEvent.ProviderWarning({
                message: 'image attachments are not forwarded to OpenCode and were dropped',
              }),
            ])
          }

          const done = yield* Deferred.make<void>()
          const finish = Deferred.complete(done, Effect.void)
          const failTurn = (cause: Cause.Cause<HarnessError>): Effect.Effect<void> =>
            Queue.failCause(queue, cause).pipe(Effect.andThen(finish))

          const bus = port.subscribe().pipe(
            Stream.filter((event) => {
              // SAFETY: bus events carry an optional sessionID in data; reading it selects this turn's own events, and an absent id means a broadcast every turn sees.
              const data = (event as { readonly data?: { readonly sessionID?: unknown } }).data
              return data?.sessionID === undefined || data.sessionID === sessionID
            }),
          )
          yield* bus.pipe(
            Stream.flatMap((event) => Stream.fromIterable(translator.ephemeral(event))),
            Stream.runForEach((event) => Queue.offer(queue, event)),
            Effect.catchCause(failTurn),
            Effect.forkScoped,
          )

          let windowOpen = false
          const none: readonly HarnessEvent[] = []
          const control = port.log({ threadId, after: cursors.get(threadId) }).pipe(
            Stream.mapEffect((event) =>
              Effect.sync(() => {
                if (event.type === 'log.synced') {
                  if (event.seq !== undefined) cursors.set(threadId, event.seq)
                  return none
                }
                if (!windowOpen) {
                  // Replay ends at the watermark; the turn's own window opens at
                  // its execution, so an older terminal can never end this turn.
                  if (event.type !== 'session.execution.started') return none
                  windowOpen = true
                }
                return translator.durable(event)
              }),
            ),
            Stream.mapEffect((events) => offer(events)),
            Stream.takeWhile(() => translator.terminal === undefined),
            Stream.runDrain,
          )
          const assemble = Effect.gen(function* () {
            const terminal = translator.terminal
            if (terminal === undefined) {
              return yield* Effect.fail(
                executionFailed('the turn ended with no terminal event', true),
              )
            }
            if (terminal.outcome === 'interrupted') {
              yield* offer([
                HarnessEvent.ProviderError({ message: terminal.reason, retryable: false }),
              ])
            }
            if (terminal.outcome === 'failed') {
              yield* offer([
                HarnessEvent.ProviderError({ message: terminal.message, retryable: false }),
              ])
            }
            const listed = yield* port.messages(threadId)
            const at = promptMessageIndex(listed.data, promptMessageID)
            const slice = at === -1 ? fallbackSlice(listed.data) : listed.data.slice(at)
            const assembly = assembleTurn(slice)
            const tokens = translator.tokensInput
            const contextWindow =
              ref === undefined
                ? undefined
                : yield* catalog.contextWindowFor(ref).pipe(Effect.orElseSucceed(() => undefined))
            if (tokens !== undefined && contextWindow !== undefined) {
              yield* offer([HarnessEvent.ContextWindow({ tokens, contextWindow })])
            }
            yield* offer(assembly.unsettledToolResults)
            const turn: Mutable<AssembledTurn> = { items: assembly.items }
            if (assembly.usage !== undefined) turn.usage = assembly.usage
            if (assembly.stopReason !== undefined) turn.stop_reason = assembly.stopReason
            yield* offer([HarnessEvent.TurnComplete({ turn })])
          })
          yield* control.pipe(
            Effect.andThen(assemble),
            Effect.andThen(Queue.end(queue)),
            Effect.andThen(finish),
            Effect.catchCause(failTurn),
            Effect.forkScoped,
          )
          // Admitted after both consumers subscribed, so no delta or fact
          // predates a subscriber; the trailing history item is the prompt.
          const trailing = request.history[request.history.length - 1]
          if (trailing !== undefined && trailing.type === 'user_message') {
            yield* port.prompt({ threadId, text: trailing.text, messageID: promptMessageID })
          }
          yield* Deferred.await(done)
        }).pipe(
          // A failing register hangs the stream on this Effect version instead
          // of failing it, so the failure is carried to the queue, which ends
          // the stream the same way the turn's own errors do.
          Effect.catchCause((cause) => Queue.failCause(queue, cause)),
          Effect.ensuring(
            Effect.sync(() => {
              host.bound.delete(request.threadId)
              host.active.delete(request.threadId)
            }),
          ),
        ),
      )
    }),
  )

/**
 * The slice after the last compaction barrier, for the unverified case where
 * a compaction rewrote the turn's own prompt message and the minted boundary
 * misses: the turn is whatever accumulated since the log was last summarized.
 */
const fallbackSlice = (
  messages: readonly SessionMessage.Info[],
): readonly SessionMessage.Info[] => {
  const barrier = messages.findLastIndex((message) => message.type === 'compaction')
  return messages.slice(barrier + 1)
}

/** Steer the running turn, or fail so the runtime queues the text instead. */
export const steerThread = (
  host: Pick<TurnHost, 'port' | 'active'>,
  threadId: string,
  text: string,
): Effect.Effect<void, HarnessError> => {
  if (!host.active.has(threadId)) return Effect.fail(noActiveTurn(threadId))
  return host.port.prompt({
    threadId,
    text,
    messageID: SessionMessage.ID.create(),
    delivery: 'steer',
  })
}

/** Interrupt the running turn; without one there is nothing to stop. */
export const abortThread = (
  host: Pick<TurnHost, 'port' | 'active'>,
  threadId: string,
): Effect.Effect<void, HarnessError> => {
  if (!host.active.has(threadId)) return Effect.fail(aborted())
  return host.port.interrupt(threadId)
}
