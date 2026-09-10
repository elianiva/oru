import { Effect } from 'effect'
import type { SessionEvent } from '@oru/kernel'
import type { ModelMessage, ModelTool } from './model.ts'
import type { PendingCall } from './session-fold.ts'
import type { ToolContribution, ToolOutcome } from './tool-kind.ts'

export const messagesOf = (
  events: readonly SessionEvent[],
  thread: string,
): readonly ModelMessage[] => {
  const messages: ModelMessage[] = []
  for (const event of events) {
    switch (event._tag) {
      case 'message/appended':
        if (event.thread !== thread) break
        if (event.role === 'user') messages.push({ _tag: 'user', body: event.body })
        if (event.role === 'assistant') messages.push({ _tag: 'assistant', body: event.body })
        break
      case 'tool/completed':
        if (event.thread !== thread) break
        messages.push({
          _tag: 'tool',
          name: event.name,
          call: event.call,
          result: event.result,
        })
        break
      default:
        break
    }
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
