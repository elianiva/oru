import { Effect, Match } from 'effect'
import { modelVisiblePath, type SessionEvent } from '@oru/kernel'
import * as Items from '@effect-uai/core/Items'
import * as Tool from '@effect-uai/core/Tool'
import * as Toolkit from '@effect-uai/core/Toolkit'
import type { PendingCall } from './session-fold.ts'
import type { ToolContribution, ToolOutcome } from './tool-kind.ts'

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
        'approval/decided': () => {},
        'thread/compacted': (event) => {
          history.push(Items.userText(event.summary))
        },
        'thread/branched': (event) => {
          if (event.summary !== undefined) history.push(Items.userText(event.summary))
        },
        'plugin/activated': () => {},
        'plugin/deactivated': () => {},
        'project/created': () => {},
        'thread/created': () => {},
        'thread/configured': () => {},
        'turn/started': () => {},
        'turn/failed': () => {},
        'agent/inbox/spliced': () => {},
      }),
    )
  }
  return history
}

export const toolkitOf = (tools: readonly ToolContribution[]) =>
  Toolkit.fromArray(
    tools.map((tool) =>
      Tool.make({
        name: tool.name,
        description: tool.description,
        inputSchema: Tool.fromEffectSchema(tool.parameters),
        run: (input) =>
          tool
            .runJson(JSON.stringify(input))
            .pipe(
              Effect.flatMap((outcome) =>
                outcome.ok ? Effect.succeed(outcome.result) : Effect.fail(outcome.result),
              ),
            ),
      }),
    ),
  )

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
