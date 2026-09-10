import { Schema } from 'effect'
import { EventId, PluginId, PluginScope, ThreadId, ToolCallId, TurnId } from './primitives.ts'

export const PluginActivated = Schema.TaggedStruct('plugin/activated', {
  plugin: PluginId,
  scope: PluginScope,
})

export const PluginDeactivated = Schema.TaggedStruct('plugin/deactivated', {
  plugin: PluginId,
  scope: PluginScope,
})

export const ThreadCreated = Schema.TaggedStruct('thread/created', {
  id: EventId,
  thread: ThreadId,
})

export const MessageRole = Schema.Literals(['user', 'assistant', 'tool'])
export type MessageRole = Schema.Schema.Type<typeof MessageRole>

export const TurnStarted = Schema.TaggedStruct('turn/started', {
  id: EventId,
  thread: ThreadId,
  turn: TurnId,
})

export const MessageAppended = Schema.TaggedStruct('message/appended', {
  id: EventId,
  thread: ThreadId,
  role: MessageRole,
  body: Schema.String,
})

export const ToolRequested = Schema.TaggedStruct('tool/requested', {
  id: EventId,
  thread: ThreadId,
  turn: TurnId,
  call: ToolCallId,
  name: Schema.NonEmptyString,
  arguments: Schema.String,
})

export const ToolCompleted = Schema.TaggedStruct('tool/completed', {
  id: EventId,
  thread: ThreadId,
  turn: TurnId,
  call: ToolCallId,
  name: Schema.NonEmptyString,
  ok: Schema.Boolean,
  result: Schema.String,
})

export const SessionEvent = Schema.Union([
  PluginActivated,
  PluginDeactivated,
  ThreadCreated,
  TurnStarted,
  MessageAppended,
  ToolRequested,
  ToolCompleted,
])
export type SessionEvent = Schema.Schema.Type<typeof SessionEvent>
