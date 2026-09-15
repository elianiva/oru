import { Schema } from 'effect'
import {
  EventId,
  PluginId,
  PluginScope,
  ProjectId,
  ThreadId,
  ToolCallId,
  TurnId,
} from './primitives.ts'

const Tree = {
  id: EventId,
  parentId: Schema.NullOr(EventId),
  seq: Schema.Number,
  timestamp: Schema.Number,
} as const

export const PluginActivated = Schema.TaggedStruct('plugin/activated', {
  ...Tree,
  plugin: PluginId,
  scope: PluginScope,
})

export const PluginDeactivated = Schema.TaggedStruct('plugin/deactivated', {
  ...Tree,
  plugin: PluginId,
  scope: PluginScope,
})

export const ProjectCreated = Schema.TaggedStruct('project/created', {
  ...Tree,
  project: ProjectId,
  name: Schema.NonEmptyString,
  cwd: Schema.NonEmptyString,
})

export const ThreadCreated = Schema.TaggedStruct('thread/created', {
  ...Tree,
  thread: ThreadId,
  project: ProjectId,
})

/**
 * What a thread is configured to run: which harness, which model, how much
 * reasoning. One fact per configuration, so the latest on the path is the
 * answer and reproduction does not depend on a mutable store. A member is
 * `undefined` when the thread leaves it to the harness's own default.
 */
export const ThreadConfigured = Schema.TaggedStruct('thread/configured', {
  ...Tree,
  thread: ThreadId,
  harness: Schema.UndefinedOr(Schema.NonEmptyString),
  model: Schema.UndefinedOr(Schema.NonEmptyString),
  reasoning: Schema.UndefinedOr(Schema.NonEmptyString),
})

export const MessageRole = Schema.Literals(['user', 'assistant', 'tool'])
export type MessageRole = typeof MessageRole.Type

export const TurnStarted = Schema.TaggedStruct('turn/started', {
  ...Tree,
  thread: ThreadId,
  turn: TurnId,
})

export const TurnFailed = Schema.TaggedStruct('turn/failed', {
  ...Tree,
  thread: ThreadId,
  turn: TurnId,
  reason: Schema.String,
})

export const MessageAppended = Schema.TaggedStruct('message/appended', {
  ...Tree,
  thread: ThreadId,
  role: MessageRole,
  body: Schema.String,
})

export const ToolRequested = Schema.TaggedStruct('tool/requested', {
  ...Tree,
  thread: ThreadId,
  turn: TurnId,
  call: ToolCallId,
  name: Schema.NonEmptyString,
  arguments: Schema.String,
})

export const ToolCompleted = Schema.TaggedStruct('tool/completed', {
  ...Tree,
  thread: ThreadId,
  turn: TurnId,
  call: ToolCallId,
  name: Schema.NonEmptyString,
  ok: Schema.Boolean,
  result: Schema.String,
})

/**
 * The human's answer to one tool request. `request` is the provider request
 * id (the tool call id), so a duplicate id folds as the same pending entry.
 */
export const ApprovalVerdict = Schema.Literals(['approve', 'deny'])
export type ApprovalVerdict = typeof ApprovalVerdict.Type

export const ApprovalDecided = Schema.TaggedStruct('approval/decided', {
  ...Tree,
  thread: ThreadId,
  request: Schema.NonEmptyString,
  decision: ApprovalVerdict,
})

export const ThreadCompacted = Schema.TaggedStruct('thread/compacted', {
  ...Tree,
  thread: ThreadId,
  summary: Schema.String,
  firstKeptEntryId: EventId,
  tokensBefore: Schema.Number,
  readFiles: Schema.Array(Schema.String),
  modifiedFiles: Schema.Array(Schema.String),
})

/**
 * A lane that continues another thread's conversation. `fromId` is the entry
 * its memory reaches back to, so the fork reprojects the source's path instead
 * of copying its facts. Absent summary means the branch left nothing behind.
 */
export const ThreadBranched = Schema.TaggedStruct('thread/branched', {
  ...Tree,
  thread: ThreadId,
  fromId: EventId,
  summary: Schema.UndefinedOr(Schema.String),
})

export const InboxQueue = Schema.Literals(['next-turn', 'next-step'])
export type InboxQueue = typeof InboxQueue.Type

export const InboxSpliced = Schema.TaggedStruct('agent/inbox/spliced', {
  ...Tree,
  thread: ThreadId,
  queue: InboxQueue,
  body: Schema.String,
})

export const SessionEvent = Schema.Union([
  PluginActivated,
  PluginDeactivated,
  ProjectCreated,
  ThreadCreated,
  ThreadConfigured,
  TurnStarted,
  TurnFailed,
  MessageAppended,
  ToolRequested,
  ToolCompleted,
  ApprovalDecided,
  ThreadCompacted,
  ThreadBranched,
  InboxSpliced,
])
export type SessionEvent = typeof SessionEvent.Type

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type SessionDraft = DistributiveOmit<SessionEvent, 'parentId' | 'seq' | 'timestamp'>
