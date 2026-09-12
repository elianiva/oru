import { Effect, Match } from 'effect'
import { modelVisiblePath, type SessionEvent } from '@oru/kernel'
import * as Items from '@effect-uai/core/Items'
import * as Tool from '@effect-uai/core/Tool'
import * as Toolkit from '@effect-uai/core/Toolkit'
import type { PendingCall } from './session-fold.ts'
import type { ToolContribution } from './tool-kind.ts'

export const historyOf = (
  events: readonly SessionEvent[],
  thread: string,
): readonly Items.HistoryItem[] => {
  const history: Items.HistoryItem[] = []
  for (const event of modelVisiblePath(events, thread)) {
    Match.value(event).pipe(
      Match.tagsExhaustive({
        'message/appended': (event) => {
          if (event.role === 'user') history.push(Items.userText(event.body))
          if (event.role === 'assistant') history.push(Items.assistantText(event.body))
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
          history.push(Items.toolCallOutput(event.call, event.result))
        },
        'thread/compacted': (event) => {
          history.push(Items.userText(event.summary))
        },
        'thread/branched': (event) => {
          history.push(Items.userText(event.summary))
        },
        'plugin/activated': () => {},
        'plugin/deactivated': () => {},
        'project/created': () => {},
        'thread/created': () => {},
        'turn/started': () => {},
        'turn/failed': () => {},
        'agent/inbox/spliced': () => {},
      }),
    )
  }
  return history
}

export const toolkitOf = (tools: readonly ToolContribution[]) =>
  Toolkit.fromArray(tools.map((tool) => tool.localTool))

export const failureReason = (cause: unknown): string => {
  if (cause instanceof Error && cause.message !== '') return cause.message
  return String(cause)
}

export const runTool = (
  tools: readonly ToolContribution[],
  pending: PendingCall,
): Effect.Effect<{ readonly ok: boolean; readonly result: string }> => {
  const tool = tools.find((candidate) => candidate.name === pending.name)
  if (tool === undefined) {
    return Effect.succeed({ ok: false, result: `unknown tool ${pending.name}` })
  }
  const ran = Tool.execute(tool.localTool, {
    type: 'function_call',
    call_id: pending.call,
    name: pending.name,
    arguments: pending.arguments,
  }).pipe(
    Effect.map((output) => ({ ok: true, result: output.output })),
    Effect.catch((cause) => Effect.succeed({ ok: false, result: failureReason(cause) })),
  )
  // SAFETY: defineTool execute is Effect<unknown> with no remaining requirements
  return ran as Effect.Effect<{ readonly ok: boolean; readonly result: string }>
}
