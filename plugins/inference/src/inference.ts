import { Clock, Context, Deferred, Effect, Match, Random, Result, Scope, Semaphore } from 'effect'
import {
  InboxSpliced,
  MessageAppended,
  ToolCompleted,
  ToolRequested,
  TurnFailed,
  TurnStarted,
  unsignedTree,
  type SessionLogContract,
  type SessionLogError,
} from '@oru/kernel'
import * as Items from '@effect-uai/core/Items'
import { type LanguageModelService } from '@effect-uai/core/LanguageModel'
import type * as Turn from '@effect-uai/core/Turn'
import { demoModelId } from './demo-model.ts'
import { failureReason, historyOf, runTool, toolkitOf } from './seam.ts'
import { foldThread, workOf } from './session-fold.ts'
import type { ToolContribution } from './tool-kind.ts'

export interface InferenceContract {
  readonly send: (thread: string, text: string) => Effect.Effect<void, SessionLogError>
  readonly whenIdle: (thread: string) => Effect.Effect<void, SessionLogError>
}

export class Inference extends Context.Service<Inference, InferenceContract>()('oru/inference') {}

const newId = Effect.fnUntraced(function* () {
  const now = yield* Clock.currentTimeMillis
  const n = yield* Random.next
  return `${now.toString(36)}-${n.toString(36).slice(2, 10)}`
})

const persistTurn = (
  log: SessionLogContract,
  thread: string,
  turn: string,
  assembled: Turn.Turn,
): Effect.Effect<void, SessionLogError> =>
  Effect.gen(function* () {
    let text = ''
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
    for (const item of assembled.items) {
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
  model: LanguageModelService,
  loadTools: Effect.Effect<readonly ToolContribution[]>,
  scope: Scope.Scope,
): InferenceContract => {
  const lock = Semaphore.makeUnsafe(1)
  const idle = new Map<string, Deferred.Deferred<void>>()
  const drain = Effect.fnUntraced(function* (thread: string) {
    for (;;) {
      const events = yield* log.entries
      const work = workOf(foldThread(events, thread))
      if (work._tag === 'Idle') return
      yield* Match.value(work).pipe(
        Match.tag('CallModel', (work) =>
          Effect.gen(function* () {
            const turn = work.turn ?? (yield* newId())
            if (work.turn === undefined) {
              yield* log.write(
                TurnStarted.make({
                  ...unsignedTree,
                  id: yield* newId(),
                  thread,
                  turn,
                }),
              )
            }
            const entry = yield* log.entries
            const history = historyOf(entry, thread)
            const tools = yield* loadTools
            const toolkit = tools.length === 0 ? undefined : toolkitOf(tools)
            const request =
              toolkit === undefined
                ? { history, model: demoModelId }
                : { history, model: demoModelId, tools: toolkit }
            const assembled = yield* Effect.result(model.turn(request))
            if (Result.isFailure(assembled)) {
              yield* log.write(
                TurnFailed.make({
                  ...unsignedTree,
                  id: yield* newId(),
                  thread,
                  turn,
                  reason: failureReason(assembled.failure),
                }),
              )
              return
            }
            yield* persistTurn(log, thread, turn, assembled.success)
          }),
        ),
        Match.tag('RunTool', (work) =>
          Effect.gen(function* () {
            const tools = yield* loadTools
            const result = yield* runTool(tools, work.pending)
            yield* log.write(
              ToolCompleted.make({
                ...unsignedTree,
                id: yield* newId(),
                thread,
                turn: work.pending.turn,
                call: work.pending.call,
                name: work.pending.name,
                ok: result.ok,
                result: result.result,
              }),
            )
          }),
        ),
        Match.exhaustive,
      )
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

  return {
    send: (thread, text) =>
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
      }),
    whenIdle: (thread) =>
      Effect.gen(function* () {
        const done = idle.get(thread)
        if (done === undefined) return
        yield* Deferred.await(done)
      }),
  }
}
