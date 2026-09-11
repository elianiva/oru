import { Match, Schema } from 'effect'
import type { SessionEvent } from '@oru/kernel'

export const UserLine = Schema.TaggedStruct('user', { body: Schema.String })
export const AssistantLine = Schema.TaggedStruct('assistant', { body: Schema.String })
export const TurnLine = Schema.TaggedStruct('turn', {})
export const ToolRequestedLine = Schema.TaggedStruct('tool/requested', { name: Schema.String })
export const ToolCompletedLine = Schema.TaggedStruct('tool/completed', { name: Schema.String })
export const TranscriptLine = Schema.Union([
  UserLine,
  AssistantLine,
  TurnLine,
  ToolRequestedLine,
  ToolCompletedLine,
])
export type TranscriptLine = typeof TranscriptLine.Type

export const lineOf = (event: SessionEvent): TranscriptLine | undefined =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      'plugin/activated': () => undefined,
      'plugin/deactivated': () => undefined,
      'thread/created': () => undefined,
      'message/appended': (event) => {
        if (event.role === 'user') return UserLine.make({ body: event.body })
        if (event.role === 'assistant') return AssistantLine.make({ body: event.body })
        return undefined
      },
      'turn/started': () => TurnLine.make({}),
      'tool/requested': (event) => ToolRequestedLine.make({ name: event.name }),
      'tool/completed': (event) => ToolCompletedLine.make({ name: event.name }),
    }),
  )

export const labelOf = (line: TranscriptLine): string =>
  Match.value(line).pipe(
    Match.tagsExhaustive({
      user: (line) => `user: ${line.body}`,
      assistant: (line) => `assistant: ${line.body}`,
      turn: () => 'turn/started',
      'tool/requested': (line) => `tool/requested ${line.name}`,
      'tool/completed': (line) => `tool/completed ${line.name}`,
    }),
  )
