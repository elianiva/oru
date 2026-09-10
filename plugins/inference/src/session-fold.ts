import type { SessionEvent, ThreadId, ToolCallId, TurnId } from '@oru/kernel'

export interface PendingCall {
  readonly turn: TurnId
  readonly call: ToolCallId
  readonly name: string
  readonly arguments: string
}

export type Work =
  | { readonly _tag: 'Idle' }
  | { readonly _tag: 'CallModel'; readonly turn: TurnId | undefined }
  | { readonly _tag: 'RunTool'; readonly pending: PendingCall }

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
    switch (event._tag) {
      case 'plugin/activated':
      case 'plugin/deactivated':
      case 'thread/created':
        break
      case 'message/appended':
        if (event.thread !== thread) break
        if (event.role === 'user') awaitingModel = true
        if (event.role === 'assistant') awaitingModel = false
        break
      case 'turn/started':
        if (event.thread !== thread) break
        openTurn = event.turn
        break
      case 'tool/requested':
        if (event.thread !== thread) break
        awaitingModel = false
        requested.push({
          turn: event.turn,
          call: event.call,
          name: event.name,
          arguments: event.arguments,
        })
        break
      case 'tool/completed':
        if (event.thread !== thread) break
        completed.add(event.call)
        awaitingModel = true
        break
      default: {
        const _exhaustive: never = event
        return _exhaustive
      }
    }
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
  if (pending !== undefined) return { _tag: 'RunTool', pending }
  if (state.awaitingModel) return { _tag: 'CallModel', turn: state.openTurn }
  return { _tag: 'Idle' }
}
