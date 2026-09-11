import { Clock, Context, Effect, Match, Random, Result } from 'effect'
import {
  MessageAppended,
  ToolCompleted,
  ToolRequested,
  TurnFailed,
  TurnStarted,
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
  readonly idle: Effect.Effect<void>
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
): InferenceContract => {
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
              yield* log.write(TurnStarted.make({ id: yield* newId(), thread, turn }))
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

  return {
    send: (thread, text) =>
      newId().pipe(
        Effect.flatMap((id) =>
          log.write(MessageAppended.make({ id, thread, role: 'user', body: text })),
        ),
        Effect.andThen(drain(thread)),
      ),
    idle: Effect.void,
  }
}
