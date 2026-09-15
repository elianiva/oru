import { Match, Schema } from 'effect'
import {
  pathOfLane,
  threadLane,
  ThreadId,
  ToolCallId,
  TurnId,
  type ApprovalVerdict,
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
export const AwaitApproval = Schema.TaggedStruct('AwaitApproval', {
  pending: PendingCall,
})
export const RecordDenied = Schema.TaggedStruct('RecordDenied', {
  pending: PendingCall,
})
export const Work = Schema.Union([Idle, CallModel, RunTool, AwaitApproval, RecordDenied])
export type Work = typeof Work.Type

export interface ThreadState {
  readonly thread: ThreadId
  readonly openTurn: TurnId | undefined
  readonly awaitingModel: boolean
  readonly pending: readonly PendingCall[]
  readonly decisions: ReadonlyMap<string, ApprovalVerdict>
}

const requestKey = (call: string): string => call

export const foldThread = (events: readonly SessionEvent[], thread: ThreadId): ThreadState => {
  let awaitingModel = false
  let openTurn: TurnId | undefined
  const pending = new Map<string, PendingCall>()
  const decisions = new Map<string, ApprovalVerdict>()

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
            requestKey(event.call),
            PendingCall.make({
              turn: event.turn,
              call: event.call,
              name: event.name,
              arguments: event.arguments,
            }),
          )
        },
        'tool/completed': (event) => {
          pending.delete(requestKey(event.call))
          awaitingModel = true
        },
        'approval/decided': (event) => {
          if (!decisions.has(event.request)) decisions.set(event.request, event.decision)
        },
      }),
    )
  }

  return {
    thread,
    openTurn,
    awaitingModel,
    pending: [...pending.values()],
    decisions,
  }
}

export const workOf = (state: ThreadState): Work => {
  const pending = state.pending[0]
  if (pending !== undefined) {
    const decision = state.decisions.get(requestKey(pending.call))
    if (decision === undefined) return AwaitApproval.make({ pending })
    if (decision === 'deny') return RecordDenied.make({ pending })
    return RunTool.make({ pending })
  }
  if (state.awaitingModel) return CallModel.make({ turn: state.openTurn })
  return Idle.make({})
}

export const decisionOf = (
  events: readonly SessionEvent[],
  thread: ThreadId,
  request: string,
): ApprovalVerdict | undefined => foldThread(events, thread).decisions.get(request)

export const pendingCallOf = (
  events: readonly SessionEvent[],
  thread: ThreadId,
  request: string,
): PendingCall | undefined =>
  foldThread(events, thread).pending.find((pending) => pending.call === request)
