import { Effect, Match } from 'effect'
import { modelVisiblePath, type SessionEvent } from '@oru/kernel'
import {
  assistantText,
  userText,
  type HistoryItem,
  type ToolContribution,
  type ToolOutcome,
} from '@oru/harness'
import type { PendingCall } from './session-fold.ts'

export const historyOf = (
  events: readonly SessionEvent[],
  thread: string,
): readonly HistoryItem[] => {
  const history: HistoryItem[] = []
  for (const event of modelVisiblePath(events, thread)) {
    Match.value(event).pipe(
      Match.tagsExhaustive({
        'message/appended': (event) => {
          if (event.role === 'user') history.push(userText(event.body))
          if (event.role === 'assistant') history.push(assistantText(event.body))
        },
        'tool/requested': (event) => {
          history.push({
            type: 'function_call',
            call_id: event.call,
            name: event.name,
            arguments: event.arguments,
          })
        },
        'tool/completed': (event) => {
          history.push({ type: 'tool_result', call_id: event.call, output: event.result })
        },
        'approval/decided': () => {},
        'thread/compacted': (event) => {
          history.push(userText(event.summary))
        },
        'thread/branched': (event) => {
          if (event.summary !== undefined) history.push(userText(event.summary))
        },
        'plugin/activated': () => {},
        'plugin/deactivated': () => {},
        'project/created': () => {},
        'project/updated': () => {},
        'project/deleted': () => {},
        'thread/created': () => {},
        'thread/configured': () => {},
        'turn/started': () => {},
        'turn/failed': () => {},
        'turn/usage': () => {},
        'thread/context-window': () => {},
        'agent/inbox/spliced': () => {},
      }),
    )
  }
  return history
}

export const failureReason = (cause: unknown): string => {
  if (cause instanceof Error && cause.message !== '') return cause.message
  return String(cause)
}

export const runTool = (
  tools: readonly ToolContribution[],
  pending: PendingCall,
): Effect.Effect<ToolOutcome> => {
  const tool = tools.find((candidate) => candidate.name === pending.name)
  if (tool === undefined) {
    return Effect.succeed({ ok: false, result: `unknown tool ${pending.name}` })
  }
  return tool.runJson(pending.arguments)
}

export const runToolByNameEffect = (
  tools: readonly ToolContribution[],
  name: string,
  argumentsJson: string,
): Effect.Effect<ToolOutcome> => {
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) {
    return Effect.succeed({ ok: false, result: `unknown tool ${name}` })
  }
  return tool.runJson(argumentsJson)
}

export const runToolByName = (
  tools: readonly ToolContribution[],
  name: string,
  argumentsJson: string,
): Promise<{ readonly ok: boolean; readonly result: string }> =>
  Effect.runPromise(runToolByNameEffect(tools, name, argumentsJson))
