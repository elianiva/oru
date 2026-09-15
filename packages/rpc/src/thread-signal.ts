import { Match, Schema } from 'effect'
import type { HarnessEvent } from '@oru/harness'

/**
 * What a thread's pane sees while a harness turn is happening (ADR-0006).
 *
 * The harness reports live events; the session log records the facts that
 * outlive the turn. This is the projection of the former: enough to watch a
 * turn as it runs, and deliberately not a second history.
 */
export const LiveText = Schema.TaggedStruct('text', { delta: Schema.String })
export const LiveThinking = Schema.TaggedStruct('thinking', { delta: Schema.String })
export const LiveToolStart = Schema.TaggedStruct('tool-start', { name: Schema.String })
export const LiveToolArgs = Schema.TaggedStruct('tool-args', { delta: Schema.String })
export const LiveToolEnd = Schema.TaggedStruct('tool-end', {
  name: Schema.String,
  ok: Schema.Boolean,
})
export const LiveCompacting = Schema.TaggedStruct('compacting', { automatic: Schema.Boolean })
export const LiveCompacted = Schema.TaggedStruct('compacted', { tokensBefore: Schema.Number })
export const LiveContextWindow = Schema.TaggedStruct('context-window', {
  tokens: Schema.Number,
  contextWindow: Schema.Number,
})
export const LiveSessionReplaced = Schema.TaggedStruct('session-replaced', {
  reason: Schema.String,
})
export const LiveWarning = Schema.TaggedStruct('warning', { message: Schema.String })
export const LiveError = Schema.TaggedStruct('error', { message: Schema.String })
export const LiveUnhandled = Schema.TaggedStruct('unhandled', { type: Schema.String })
export const LiveSettled = Schema.TaggedStruct('settled', {})

export const LiveLine = Schema.Union([
  LiveText,
  LiveThinking,
  LiveToolStart,
  LiveToolEnd,
  LiveCompacting,
  LiveCompacted,
  LiveContextWindow,
  LiveSessionReplaced,
  LiveWarning,
  LiveError,
  LiveUnhandled,
  LiveSettled,
])
export type LiveLine = typeof LiveLine.Type

export const ThreadSignal = Schema.Union([
  LiveText,
  LiveThinking,
  LiveToolStart,
  LiveToolArgs,
  LiveToolEnd,
  LiveCompacting,
  LiveCompacted,
  LiveContextWindow,
  LiveSessionReplaced,
  LiveWarning,
  LiveError,
  LiveUnhandled,
  LiveSettled,
])
export type ThreadSignal = typeof ThreadSignal.Type

/**
 * An event with no view in this vocabulary returns nothing, which is how a
 * streaming detail the pane does not draw, a partial image or a citation,
 * disappears instead of turning into a line nobody can read.
 */
export const signalOf = (event: HarnessEvent): ThreadSignal | undefined =>
  Match.value(event).pipe(
    Match.tag('TextDelta', (event) => LiveText.make({ delta: event.text })),
    Match.tag('ReasoningDelta', (event) => LiveThinking.make({ delta: event.text })),
    Match.tag('ToolCallStart', (event) => LiveToolStart.make({ name: event.name })),
    Match.tag('ToolCallArgsDelta', (event) => LiveToolArgs.make({ delta: event.delta })),
    Match.tag('ToolResult', (event) => LiveToolEnd.make({ name: event.name, ok: event.ok })),
    Match.tag('CompactionStarted', (event) => LiveCompacting.make({ automatic: event.automatic })),
    Match.tag('CompactionEnded', (event) =>
      LiveCompacted.make({ tokensBefore: event.tokensBefore }),
    ),
    Match.tag('ContextWindow', (event) =>
      LiveContextWindow.make({ tokens: event.tokens, contextWindow: event.contextWindow }),
    ),
    Match.tag('SessionReplaced', (event) => LiveSessionReplaced.make({ reason: event.reason })),
    Match.tag('ProviderWarning', (event) => LiveWarning.make({ message: event.message })),
    Match.tag('ProviderError', (event) => LiveError.make({ message: event.message })),
    Match.tag('RawUnhandled', (event) => LiveUnhandled.make({ type: event.type })),
    Match.tag('TurnComplete', () => LiveSettled.make({})),
    Match.orElse(() => undefined),
  )
