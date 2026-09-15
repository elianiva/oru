import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import { SessionEvent, ThreadId } from '@oru/kernel'
import { ThreadOptions } from './thread-options.ts'
import { ThreadSignal } from './thread-signal.ts'

export const ThreadRpc = RpcGroup.make(
  Rpc.make('CreateThread', {
    payload: { cwd: Schema.UndefinedOr(Schema.String) },
    success: Schema.Struct({ threadId: ThreadId }),
  }),
  Rpc.make('SendMessage', {
    payload: { threadId: ThreadId, text: Schema.String },
    success: Schema.Void,
  }),
  Rpc.make('WatchThread', {
    payload: { threadId: ThreadId },
    success: SessionEvent,
    stream: true,
  }),
  /** What the pane needs to offer a choice: current configuration and the options. */
  Rpc.make('ThreadOptions', {
    payload: { threadId: ThreadId },
    success: ThreadOptions,
  }),
  Rpc.make('ConfigureThread', {
    payload: {
      threadId: ThreadId,
      harness: Schema.UndefinedOr(Schema.NonEmptyString),
      model: Schema.UndefinedOr(Schema.NonEmptyString),
      reasoning: Schema.UndefinedOr(Schema.NonEmptyString),
    },
    success: ThreadOptions,
  }),
  /** Live harness events for the running turn, for a pane that watches it happen. */
  Rpc.make('WatchSignals', {
    payload: { threadId: ThreadId },
    success: ThreadSignal,
    stream: true,
  }),
  Rpc.make('StopThread', { payload: { threadId: ThreadId }, success: Schema.Void }),
  Rpc.make('DiscardThread', { payload: { threadId: ThreadId }, success: Schema.Void }),
  Rpc.make('CompactThread', {
    payload: { threadId: ThreadId, instructions: Schema.UndefinedOr(Schema.String) },
    success: Schema.Void,
  }),
  Rpc.make('ForkThread', {
    payload: { sourceThreadId: ThreadId, cwd: Schema.UndefinedOr(Schema.String) },
    success: Schema.Struct({ threadId: ThreadId }),
  }),
)
