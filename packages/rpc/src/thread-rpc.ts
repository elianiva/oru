import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import {
  ProjectId,
  ProviderUnavailable,
  SessionEvent,
  ThreadId,
  UnknownProject,
  UnknownThread,
} from '@oru/kernel'
import { Project } from './project.ts'
import { ThreadOptions } from './thread-options.ts'
import { ThreadSignal } from './thread-signal.ts'

export class CompactFailed extends Schema.TaggedError<CompactFailed>()('CompactFailed', {
  thread: ThreadId,
  reason: Schema.String,
}) {}

export const ThreadSummary = Schema.Struct({
  thread: ThreadId,
  project: ProjectId,
  title: Schema.String,
  updatedAt: Schema.Number,
  cwd: Schema.UndefinedOr(Schema.String),
})
export type ThreadSummary = typeof ThreadSummary.Type

export const ThreadRpc = RpcGroup.make(
  Rpc.make('CreateThread', {
    /**
     * The configuration rides with the creation, so a lazily created thread is
     * born configured in one round trip with no window where it is not.
     */
    payload: {
      project: ProjectId,
      harness: Schema.UndefinedOr(Schema.NonEmptyString),
      model: Schema.UndefinedOr(Schema.NonEmptyString),
      reasoning: Schema.UndefinedOr(Schema.NonEmptyString),
      cwd: Schema.optional(Schema.String),
    },
    success: Schema.Struct({ threadId: ThreadId, project: Project }),
    error: Schema.Union([UnknownProject, ProviderUnavailable]),
  }),
  Rpc.make('SendMessage', {
    payload: { threadId: ThreadId, text: Schema.String },
    success: Schema.Void,
    error: ProviderUnavailable,
  }),
  Rpc.make('WatchThread', {
    payload: { threadId: ThreadId },
    success: SessionEvent,
    stream: true,
  }),
  /**
   * What the pane needs to offer a choice: current configuration and the
   * options. An absent thread names one that does not exist yet, so the answer
   * is the host's defaults.
   */
  Rpc.make('ThreadOptions', {
    payload: {
      threadId: Schema.UndefinedOr(ThreadId),
      refresh: Schema.optionalKey(Schema.Boolean),
    },
    success: ThreadOptions,
    error: ProviderUnavailable,
  }),
  Rpc.make('ConfigureThread', {
    payload: {
      threadId: ThreadId,
      harness: Schema.UndefinedOr(Schema.NonEmptyString),
      model: Schema.UndefinedOr(Schema.NonEmptyString),
      reasoning: Schema.UndefinedOr(Schema.NonEmptyString),
    },
    success: ThreadOptions,
    error: ProviderUnavailable,
  }),
  /** Live harness events for the running turn, for a pane that watches it happen. */
  Rpc.make('WatchSignals', {
    payload: { threadId: ThreadId },
    success: ThreadSignal,
    stream: true,
    error: ProviderUnavailable,
  }),
  Rpc.make('StopThread', {
    payload: { threadId: ThreadId },
    success: Schema.Void,
    error: ProviderUnavailable,
  }),
  Rpc.make('DiscardThread', {
    payload: { threadId: ThreadId },
    success: Schema.Void,
    error: ProviderUnavailable,
  }),
  Rpc.make('CompactThread', {
    payload: { threadId: ThreadId, instructions: Schema.UndefinedOr(Schema.String) },
    success: Schema.Void,
    error: Schema.Union([CompactFailed, ProviderUnavailable]),
  }),
  Rpc.make('WaitThread', {
    payload: { threadId: ThreadId },
    success: Schema.Void,
    error: ProviderUnavailable,
  }),
  Rpc.make('ListThreads', {
    payload: { project: Schema.optional(ProjectId) },
    success: Schema.Array(ThreadSummary),
  }),
  Rpc.make('ForkThread', {
    payload: { sourceThreadId: ThreadId, cwd: Schema.UndefinedOr(Schema.String) },
    success: Schema.Struct({ threadId: ThreadId }),
    error: Schema.Union([UnknownThread, UnknownProject, ProviderUnavailable]),
  }),
  Rpc.make('DecideApproval', {
    payload: {
      threadId: ThreadId,
      request: Schema.NonEmptyString,
      decision: Schema.Literals(['approve', 'deny']),
    },
    success: Schema.Void,
    error: ProviderUnavailable,
  }),
)
