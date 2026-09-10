import { Effect, Match } from 'effect'
import type { SessionEvent } from '@oru/kernel'
import {
  AssistantMessage,
  ToolMessage,
  UserMessage,
  type ModelMessage,
  type ModelTool,
} from './model.ts'
import type { PendingCall } from './session-fold.ts'
import type { ToolContribution, ToolOutcome } from './tool-kind.ts'

export const messagesOf = (
  events: readonly SessionEvent[],
  thread: string,
): readonly ModelMessage[] => {
  const messages: ModelMessage[] = []
  for (const event of events) {
    Match.value(event).pipe(
      Match.tagsExhaustive({
        'message/appended': (event) => {
          if (event.thread !== thread) return
          if (event.role === 'user') messages.push(UserMessage.make({ body: event.body }))
          if (event.role === 'assistant') messages.push(AssistantMessage.make({ body: event.body }))
        },
        'tool/completed': (event) => {
          if (event.thread !== thread) return
          messages.push(
            ToolMessage.make({
              name: event.name,
              call: event.call,
              result: event.result,
            }),
          )
        },
        'plugin/activated': () => {},
        'plugin/deactivated': () => {},
        'thread/created': () => {},
        'turn/started': () => {},
        'tool/requested': () => {},
      }),
    )
  }
  return messages
}

export const descriptorsOf = (tools: readonly ToolContribution[]): readonly ModelTool[] =>
  tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJson: '{}',
  }))

export const runTool = (
  tools: readonly ToolContribution[],
  pending: PendingCall,
): Effect.Effect<ToolOutcome> => {
  const tool = tools.find((candidate) => candidate.name === pending.name)
  if (tool === undefined) {
    return Effect.succeed({ ok: false, result: `unknown tool ${pending.name}` })
  }
  return tool.execute(pending.arguments)
}
