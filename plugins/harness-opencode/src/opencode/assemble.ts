import { HarnessEvent, type HistoryItem, type TurnUsage } from '@oru/harness'
import type { SessionMessage } from '@opencode/schema/session-message'
import { callOf, renderContent } from './translate.ts'

/**
 * What one turn left in OpenCode's own session, read back as oru's vocabulary.
 *
 * The read-back is the whole point: the durable stream says a turn happened,
 * but the session's message projection is what the model was actually shown,
 * in the order it was shown, including text a stream fragment may have lost.
 * The turn is the slice after the prompt message, which the bridge minted, so
 * the boundary is exact rather than a guess about timestamps.
 *
 * Two rules keep the record honest:
 *
 * - a call that had not settled by the terminal still gets an output item,
 *   because a function_call with no pair leaves the runtime work pending and
 *   the runtime would run oru's tool a second time after the turn ended;
 * - reasoning parts are not recorded, matching the reasoning capability the
 *   bridge reports: what is never shown is also not written down.
 */
export interface Assembly {
  readonly items: readonly HistoryItem[]
  /** Absent when no message in the slice reported usage. */
  readonly usage: TurnUsage | undefined
  readonly stopReason: string | undefined
  /** One `ToolResult` per call the terminal caught mid-flight, so its `ok` is false. */
  readonly unsettledToolResults: readonly HarnessEvent[]
}

/** The trailing message the bridge is about to admit as the prompt. */
export const promptMessageIndex = (
  messages: readonly SessionMessage.Info[],
  promptMessageID: string,
): number => messages.findIndex((message) => message.id === promptMessageID)

export const assembleTurn = (messages: readonly SessionMessage.Info[]): Assembly => {
  const items: HistoryItem[] = []
  const unsettledToolResults: HarnessEvent[] = []
  let input = 0
  let output = 0
  let cost = 0
  let reported = false
  let stopReason: string | undefined

  for (const message of messages) {
    if (message.type === 'user') {
      // Files are not carried: the bridge reports no image support, and a path
      // in a transcript is a reference the record cannot resolve on its own.
      if (message.text !== '') items.push({ type: 'user_message', text: message.text })
      continue
    }
    if (message.type !== 'assistant') continue

    if (message.tokens !== undefined) {
      input += message.tokens.input
      output += message.tokens.output
      reported = true
    }
    if (message.cost !== undefined) {
      cost += message.cost
      reported = true
    }
    if (message.finish !== undefined) stopReason = message.finish

    for (const part of message.content) {
      if (part.type === 'text') {
        if (part.text !== '') items.push({ type: 'assistant_message', text: part.text })
        continue
      }
      if (part.type === 'tool') {
        const call_id = callOf(message.id, part.id)
        items.push({
          type: 'function_call',
          call_id,
          name: part.name,
          arguments: argumentsOf(part.state),
        })
        const state = part.state
        if (state.status === 'completed') {
          items.push({ type: 'tool_result', call_id, output: renderContent(state.content) })
        } else if (state.status === 'error') {
          items.push({ type: 'tool_result', call_id, output: state.error.message })
        } else {
          // Streaming or still running at the terminal: settle it here as not
          // ok, so the record closes the call instead of scheduling the tool.
          const result = 'the call had not settled when the turn ended'
          items.push({ type: 'tool_result', call_id, output: result })
          unsettledToolResults.push(
            HarnessEvent.ToolResult({ call_id, name: part.name, ok: false, result }),
          )
        }
        continue
      }
      // A reasoning part: dropped with the capability, see the module note.
    }
  }

  return {
    items,
    usage: reported
      ? { input_tokens: input, output_tokens: output, total_tokens: input + output, cost }
      : undefined,
    stopReason,
    unsettledToolResults,
  }
}

/** A call's arguments as the canonical JSON text the record stores. */
const argumentsOf = (state: SessionMessage.ToolState): string =>
  state.status === 'streaming' ? state.input : JSON.stringify(state.input)
