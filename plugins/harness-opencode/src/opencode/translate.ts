import { HarnessEvent } from '@oru/harness'
import type { OpenCodeEvent } from '@opencode/client/effect'
import type { SessionLogOutput } from '@opencode/client/effect/api'

/**
 * OpenCode events translated into the bridge's narrow grammar.
 *
 * Two channels, split by what each is guaranteed to carry:
 *
 * - the durable log (`session.log`) is ordered, replayable from a cursor, and
 *   holds every fact plus the execution terminal, so it is the only channel a
 *   completion may be read from;
 * - the event bus carries the stream fragments that never reach the log, so it
 *   carries deltas and nothing else.
 *
 * The bus is volatile by contract (a slow consumer overflows it), which is why
 * no fact is read from there: a dropped `text.delta` costs a view a few
 * characters until the replayable `text.ended` boundary fills the gap, while a
 * dropped terminal would hang the turn.
 *
 * v2 events carry no call id, so a tool call is correlated by
 * (assistantMessageID, id); both channels and the message projection agree on
 * that pair, which is what keeps a live call, its settled result, and its
 * assembled items one call.
 */

/** The one identity a tool call has across the live channels and the record. */
export const callOf = (assistantMessageID: string, id: string): string =>
  `${assistantMessageID}:${id}`

/** How an execution ended, as the stream's own failure or completion reads it. */
export type Terminal =
  | { readonly outcome: 'succeeded' }
  | { readonly outcome: 'failed'; readonly message: string }
  | { readonly outcome: 'interrupted'; readonly reason: string }

/**
 * Durable types the bridge understands but has no event for.
 *
 * Listed rather than defaulted so a type OpenCode adds stays visible: an
 * unknown one falls through to `RawUnhandled` instead of disappearing.
 */
const KNOWN_IRRELEVANT = new Set([
  // The replay-to-live watermark, not a session fact: it says the read caught
  // up, which the turn's terminal already decides.
  'log.synced',
  'session.created',
  'session.agent.selected',
  'session.model.selected',
  'session.moved',
  'session.renamed',
  'session.permissions',
  'session.viewed',
  'session.message.content.updated',
  'session.usage.recorded',
  'session.usage.updated',
  'session.deleted',
  'session.forked',
  'session.inbox.delivered',
  'session.inbox.enqueued',
  'session.inbox.cancelled',
  'session.inbox.delivery.changed',
  'session.instructions.updated',
  'session.synthetic',
  'session.skill.activated',
  'session.shell.started',
  'session.shell.ended',
  'session.execution.started',
  'session.step.started',
  'session.step.streamed',
  'session.retry.scheduled',
  'session.text.started',
  'session.reasoning.started',
  'session.reasoning.ended',
  'session.tool.called',
  'session.tool.progress',
  'session.compaction.failed',
  'session.compaction.delta',
  'session.revert.staged',
  'session.revert.cleared',
  'session.revert.committed',
])

/**
 * One turn's translation, holding the small state a single event cannot.
 *
 * The state is what makes two channels agree: the counters let a replayable
 * boundary fill only the tail a lost fragment left out (so a view never sees a
 * sentence twice), the name map lets a settled call report the name its
 * terminal event does not repeat, and the terminal itself is latched once so
 * the turn ends on the first one rather than racing a second.
 */
export class TurnTranslator {
  /** ordinal -> characters already shown, for the `text` gap fill. */
  private readonly textShown = new Map<number, number>()
  /** call id -> argument characters already shown, for the args gap fill. */
  private readonly argsShown = new Map<string, number>()
  /** call ids whose start was observed, so their deltas need no buffering. */
  private readonly started = new Set<string>()
  /** arguments that streamed before their start arrived on the other channel. */
  private readonly pendingArgs = new Map<string, string>()
  /** call id -> tool name, because the terminal events omit it. */
  private readonly names = new Map<string, string>()
  private lastTokensInput: number | undefined
  private ended: Terminal | undefined

  /** The first execution terminal seen; `undefined` while the turn runs. */
  get terminal(): Terminal | undefined {
    return this.ended
  }

  /**
   * The most recent pre-compaction context size: the `step.ended` input count
   * is what the next request will be built from, which is the number a
   * compaction fact has to report as what it cut down from.
   */
  get tokensInput(): number | undefined {
    return this.lastTokensInput
  }

  durable(event: SessionLogOutput): HarnessEvent[] {
    switch (event.type) {
      case 'session.tool.input.started': {
        const call = callOf(event.data.assistantMessageID, event.data.id)
        this.started.add(call)
        this.names.set(call, event.data.name)
        const out: HarnessEvent[] = [
          HarnessEvent.ToolCallStart({ call_id: call, name: event.data.name }),
        ]
        const buffered = this.pendingArgs.get(call)
        if (buffered !== undefined) {
          this.pendingArgs.delete(call)
          this.argsShown.set(call, buffered.length)
          out.push(HarnessEvent.ToolCallArgsDelta({ call_id: call, delta: buffered }))
        }
        return out
      }
      case 'session.tool.input.ended': {
        // The boundary carries the whole argument text, so it can settle a
        // fragment the bus dropped without repeating what already streamed.
        const call = callOf(event.data.assistantMessageID, event.data.id)
        return this.argsTail(call, event.data.text)
      }
      case 'session.text.ended':
        return this.textTail(event.data.ordinal, event.data.text)
      case 'session.tool.success':
        return [
          HarnessEvent.ToolResult({
            call_id: callOf(event.data.assistantMessageID, event.data.id),
            name: this.names.get(callOf(event.data.assistantMessageID, event.data.id)) ?? '',
            ok: true,
            result: renderContent(event.data.content),
          }),
        ]
      case 'session.tool.failed':
        return [
          HarnessEvent.ToolResult({
            call_id: callOf(event.data.assistantMessageID, event.data.id),
            name: this.names.get(callOf(event.data.assistantMessageID, event.data.id)) ?? '',
            ok: false,
            result: event.data.error.message,
          }),
        ]
      case 'session.step.ended':
        this.lastTokensInput = event.data.tokens.input
        return []
      case 'session.step.failed':
        return [HarnessEvent.ProviderError({ message: event.data.error.message, retryable: true })]
      case 'session.compaction.started':
        return [HarnessEvent.CompactionStarted({ automatic: event.data.reason === 'auto' })]
      case 'session.compaction.ended': {
        // The summarizer reads the whole context, so the compaction's own input
        // count is the honest fallback when no step has reported one yet. A 0
        // means neither reported a size; the cut itself is still worth the fact.
        const before = this.lastTokensInput ?? event.data.tokens?.input ?? 0
        return [
          HarnessEvent.CompactionEnded({
            automatic: event.data.reason === 'auto',
            summary: event.data.text,
            tokensBefore: before,
            readFiles: [],
            modifiedFiles: [],
          }),
        ]
      }
      case 'session.execution.succeeded':
        this.latch({ outcome: 'succeeded' })
        return []
      case 'session.execution.failed':
        this.latch({ outcome: 'failed', message: event.data.error.message })
        return []
      case 'session.execution.interrupted':
        this.latch({ outcome: 'interrupted', reason: event.data.reason })
        return []
      default: {
        if (KNOWN_IRRELEVANT.has(event.type)) return []
        const payload = 'data' in event ? JSON.stringify(event.data) : JSON.stringify(event)
        return [HarnessEvent.RawUnhandled({ type: event.type, payload })]
      }
    }
  }

  /**
   * Stream fragments, which exist only here. Everything else on the bus is
   * either a durable event the log already carries (reading it twice would
   * duplicate a fact) or a fragment with no oru counterpart.
   */
  ephemeral(event: OpenCodeEvent): HarnessEvent[] {
    switch (event.type) {
      case 'session.text.delta': {
        const ordinal = event.data.ordinal
        const shown = this.textShown.get(ordinal) ?? 0
        this.textShown.set(ordinal, shown + event.data.delta.length)
        return [HarnessEvent.TextDelta({ text: event.data.delta })]
      }
      case 'session.tool.input.delta':
        return this.argsDelta(
          callOf(event.data.assistantMessageID, event.data.id),
          event.data.delta,
        )
      default:
        // `reasoning.*` has no level to forward (no per-turn field in OpenCode's
        // prompt input), and the bridge reports reasoning as off, so the
        // fragments are not shown rather than shown under a flag that denies them.
        return []
    }
  }

  private latch(terminal: Terminal): void {
    if (this.ended === undefined) this.ended = terminal
  }

  private textTail(ordinal: number, text: string): HarnessEvent[] {
    const shown = this.textShown.get(ordinal) ?? 0
    if (text.length <= shown) return []
    const tail = text.slice(shown)
    this.textShown.set(ordinal, text.length)
    return [HarnessEvent.TextDelta({ text: tail })]
  }

  private argsTail(call: string, text: string): HarnessEvent[] {
    const shown = this.argsShown.get(call) ?? 0
    if (text.length <= shown) return []
    const tail = text.slice(shown)
    this.argsShown.set(call, text.length)
    if (this.started.has(call))
      return [HarnessEvent.ToolCallArgsDelta({ call_id: call, delta: tail })]
    const buffered = this.pendingArgs.get(call) ?? ''
    this.pendingArgs.set(call, buffered + tail)
    return []
  }

  private argsDelta(call: string, delta: string): HarnessEvent[] {
    if (this.started.has(call)) {
      this.argsShown.set(call, (this.argsShown.get(call) ?? 0) + delta.length)
      return [HarnessEvent.ToolCallArgsDelta({ call_id: call, delta })]
    }
    const buffered = this.pendingArgs.get(call) ?? ''
    this.pendingArgs.set(call, buffered + delta)
    return []
  }
}

/**
 * A model's rendered output: text parts are read, a file part reads as the
 * thing a model would open, and anything unrecognised is kept rather than
 * dropped. Typed structurally because both the event payload and the stored
 * tool state carry `Content`, and neither is widened to the other here.
 */
export const renderContent = (
  content: readonly { readonly type: string; readonly text?: string; readonly uri?: string }[],
): string => {
  const rendered: string[] = []
  for (const part of content) {
    const text =
      part.type === 'text' && part.text !== undefined
        ? part.text
        : part.type === 'file' && part.uri !== undefined
          ? part.uri
          : JSON.stringify(part)
    if (text !== '') rendered.push(text)
  }
  return rendered.join('\n')
}
