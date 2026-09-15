import { Match, Schema } from 'effect'
import {
  pathOfLane,
  threadLane,
  ThreadId,
  ToolCallId,
  TurnId,
  type SessionEvent,
} from '@oru/kernel'

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
  // Keyed by turn and call, so a harness reusing a call id in a later turn is
  // asking again, and a request that follows its own completion reopens the
  // work instead of leaving the turn with no answer and nothing to run.
  const pending = new Map<string, PendingCall>()

  for (const event of pathOfLane(events, threadLane(thread))) {
    Match.value(event).pipe(
      Match.tagsExhaustive({
        'plugin/activated': () => {},
        'plugin/deactivated': () => {},
        'project/created': () => {},
        'thread/created': () => {},
        'thread/compacted': () => {},
        'thread/branched': () => {},
        'thread/configured': () => {},
        'agent/inbox/spliced': () => {},
        'message/appended': (event) => {
          if (event.role === 'user') awaitingModel = true
          // The model answered, so this turn is closed and the next request
          // opens its own rather than continuing this one.
          if (event.role === 'assistant') {
            awaitingModel = false
            openTurn = undefined
          }
        },
        'turn/started': (event) => {
          openTurn = event.turn
        },
        'turn/failed': () => {
          awaitingModel = false
          openTurn = undefined
        },
        'tool/requested': (event) => {
          awaitingModel = false
          pending.set(
            `${event.turn}:${event.call}`,
            PendingCall.make({
              turn: event.turn,
              call: event.call,
              name: event.name,
              arguments: event.arguments,
            }),
          )
        },
        'tool/completed': (event) => {
          pending.delete(`${event.turn}:${event.call}`)
          awaitingModel = true
        },
      }),
    )
  }

  return {
    thread,
    openTurn,
    awaitingModel,
    pending: [...pending.values()],
  }
}

export const workOf = (state: ThreadState): Work => {
  const pending = state.pending[0]
  if (pending !== undefined) return RunTool.make({ pending })
  if (state.awaitingModel) return CallModel.make({ turn: state.openTurn })
  return Idle.make({})
}
