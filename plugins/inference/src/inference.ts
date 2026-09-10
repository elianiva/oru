import { Clock, Context, Effect, Match, Random, Stream } from 'effect'
import {
  MessageAppended,
  ToolCompleted,
  ToolRequested,
  TurnStarted,
  type SessionLogContract,
  type SessionLogError,
} from '@oru/kernel'
import type { ModelService } from './model.ts'
import { descriptorsOf, messagesOf, runTool } from './seam.ts'
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

export const openInference = (
  log: SessionLogContract,
  model: ModelService,
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
            const history = messagesOf(yield* log.entries, thread)
            const tools = yield* loadTools
            const produced = yield* model.streamTurn(history, descriptorsOf(tools))
            yield* produced.pipe(
              Stream.runForEach((event) =>
                Match.value(event).pipe(
                  Match.tagsExhaustive({
                    text: (event) =>
                      newId().pipe(
                        Effect.flatMap((id) =>
                          log.write(
                            MessageAppended.make({
                              id,
                              thread,
                              role: 'assistant',
                              body: event.text,
                            }),
                          ),
                        ),
                      ),
                    tool: (event) =>
                      newId().pipe(
                        Effect.flatMap((id) =>
                          log.write(
                            ToolRequested.make({
                              id,
                              thread,
                              turn,
                              call: event.call,
                              name: event.name,
                              arguments: event.arguments,
                            }),
                          ),
                        ),
                      ),
                  }),
                ),
              ),
            )
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
