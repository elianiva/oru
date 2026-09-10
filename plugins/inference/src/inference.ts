import { Effect, Stream } from 'effect'
import {
  MessageAppended,
  ToolCompleted,
  ToolRequested,
  TurnStarted,
  defineService,
  type SessionLog,
  type SessionLogError,
} from '@oru/kernel'
import type { ModelService } from './model.ts'
import { descriptorsOf, messagesOf, runTool } from './seam.ts'
import { foldThread, workOf } from './session-fold.ts'
import type { ToolContribution } from './tool-kind.ts'

export interface Inference {
  readonly send: (thread: string, text: string) => Effect.Effect<void, SessionLogError>
  readonly idle: Effect.Effect<void>
}

export const Inference = defineService<Inference>('oru/inference')

const newId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export const openInference = (
  log: SessionLog,
  model: ModelService,
  loadTools: Effect.Effect<readonly ToolContribution[]>,
): Effect.Effect<Inference> =>
  Effect.sync(() => {
    const drain = (thread: string): Effect.Effect<void, SessionLogError> =>
      Effect.gen(function* () {
        for (;;) {
          const events = yield* log.entries
          const work = workOf(foldThread(events, thread))
          if (work._tag === 'Idle') return
          if (work._tag === 'CallModel') {
            const turn = work.turn ?? newId()
            if (work.turn === undefined) {
              yield* log.write(TurnStarted.make({ id: newId(), thread, turn }))
            }
            const history = messagesOf(yield* log.entries, thread)
            const tools = yield* loadTools
            const produced = yield* model.streamTurn(history, descriptorsOf(tools))
            yield* produced.pipe(
              Stream.runForEach((event) => {
                if (event._tag === 'text') {
                  return log.write(
                    MessageAppended.make({
                      id: newId(),
                      thread,
                      role: 'assistant',
                      body: event.text,
                    }),
                  )
                }
                return log.write(
                  ToolRequested.make({
                    id: newId(),
                    thread,
                    turn,
                    call: event.call,
                    name: event.name,
                    arguments: event.arguments,
                  }),
                )
              }),
            )
            continue
          }
          const tools = yield* loadTools
          const result = yield* runTool(tools, work.pending)
          yield* log.write(
            ToolCompleted.make({
              id: newId(),
              thread,
              turn: work.pending.turn,
              call: work.pending.call,
              name: work.pending.name,
              ok: result.ok,
              result: result.result,
            }),
          )
        }
      })

    return {
      send: (thread, text) =>
        log
          .write(MessageAppended.make({ id: newId(), thread, role: 'user', body: text }))
          .pipe(Effect.andThen(drain(thread))),
      idle: Effect.void,
    }
  })
