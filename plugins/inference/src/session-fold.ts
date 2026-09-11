import { Match, Schema } from 'effect'
import { ThreadId, ToolCallId, TurnId, type SessionEvent } from '@oru/kernel'

export const PendingCall = Schema.Struct({
  turn: TurnId,
  call: ToolCallId,
  name: Schema.String,
  arguments: Schema.String,
})
export type PendingCall = typeof PendingCall.Type

export const Idle = Schema.TaggedStruct('Idle', {})
export const CallModel = Schema.TaggedStruct('CallModel', {
  turn: Schema.UndefinedOr(TurnId),
})
export const RunTool = Schema.TaggedStruct('RunTool', {
  pending: PendingCall,
})
export const Work = Schema.Union([Idle, CallModel, RunTool])
export type Work = typeof Work.Type

export interface ThreadState {
  readonly thread: ThreadId
  readonly openTurn: TurnId | undefined
  readonly awaitingModel: boolean
  readonly pending: readonly PendingCall[]
}

export const foldThread = (events: readonly SessionEvent[], thread: ThreadId): ThreadState => {
  let awaitingModel = false
  let openTurn: TurnId | undefined
  const requested: PendingCall[] = []
  const completed = new Set<string>()

  for (const event of events) {
    Match.value(event).pipe(
      Match.tagsExhaustive({
        'plugin/activated': () => {},
        'plugin/deactivated': () => {},
        'thread/created': () => {},
        'message/appended': (event) => {
          if (event.thread !== thread) return
          if (event.role === 'user') awaitingModel = true
          if (event.role === 'assistant') awaitingModel = false
        },
        'turn/started': (event) => {
          if (event.thread !== thread) return
          openTurn = event.turn
        },
        'turn/failed': (event) => {
          if (event.thread !== thread) return
          awaitingModel = false
        },
        'tool/requested': (event) => {
          if (event.thread !== thread) return
          awaitingModel = false
          requested.push(
            PendingCall.make({
              turn: event.turn,
              call: event.call,
              name: event.name,
              arguments: event.arguments,
            }),
          )
        },
        'tool/completed': (event) => {
          if (event.thread !== thread) return
          completed.add(event.call)
          awaitingModel = true
        },
      }),
    )
  }

  return {
    thread,
    openTurn,
    awaitingModel,
    pending: requested.filter((call) => !completed.has(call.call)),
  }
}

export const workOf = (state: ThreadState): Work => {
  const pending = state.pending[0]
  if (pending !== undefined) return RunTool.make({ pending })
  if (state.awaitingModel) return CallModel.make({ turn: state.openTurn })
  return Idle.make({})
}
