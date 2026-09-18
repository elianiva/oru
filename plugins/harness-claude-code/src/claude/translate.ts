import { Option, Schema } from 'effect'
import {
  isAssistantMessage,
  isToolCall,
  isToolCallOutput,
  isUserMessage,
  type HistoryItem,
  type TurnUsage,
} from '@oru/harness'

/**
 * oru's turn vocabulary in, `claude -p` argv and `HarnessEvent`s out.
 *
 * The CLI owns the conversation: the first turn seeds it with the thread's
 * full history as one prompt, and later turns send only the latest user text
 * while `--resume` points at the running session. The stream is `stream-json`
 * lines; every line is decoded through a schema at this boundary, so a line
 * the CLI changed shape on is skipped rather than failing the turn.
 */

/** Only the tail counts: Claude Code owns the loop, so anything else ends the history. */
export const latestUserText = (history: readonly HistoryItem[]): string | undefined => {
  const item = history.at(-1)
  if (item === undefined || !isUserMessage(item)) return undefined
  return item.text === '' ? undefined : item.text
}

/**
 * The prompt a fresh session starts from: the thread's history as a plain
 * transcript. Tool calls ride along as text because v1 forwards no tools; the
 * trailing user message stays in because it is what the fresh session answers.
 */
export const historyToPrompt = (history: readonly HistoryItem[]): string => {
  const lines: string[] = []
  for (const item of history) {
    if (isUserMessage(item)) {
      if (item.text !== '') lines.push(`User: ${item.text}`)
      continue
    }
    if (isAssistantMessage(item)) {
      if (item.text !== '') lines.push(`Assistant: ${item.text}`)
      continue
    }
    if (isToolCall(item)) {
      lines.push(`Tool call ${item.name} ${item.arguments}`)
      continue
    }
    if (isToolCallOutput(item)) {
      lines.push(`Tool result: ${item.output}`)
      continue
    }
  }
  return lines.join('\n\n')
}

const decodeOption = Schema.decodeUnknownOption

const SessionRef = Schema.Struct({
  session_id: Schema.optional(Schema.String),
})

const TextDeltaEvent = Schema.Struct({
  type: Schema.Literal('stream_event'),
  session_id: Schema.optional(Schema.String),
  event: Schema.Struct({
    delta: Schema.Struct({
      type: Schema.Literal('text_delta'),
      text: Schema.String,
    }),
  }),
})

const AssistantLine = Schema.Struct({
  type: Schema.Literal('assistant'),
  session_id: Schema.optional(Schema.String),
  message: Schema.Struct({
    content: Schema.optional(
      Schema.Array(
        Schema.Struct({
          type: Schema.String,
          text: Schema.optional(Schema.String),
        }),
      ),
    ),
  }),
})

const ResultLine = Schema.Struct({
  type: Schema.Literal('result'),
  session_id: Schema.optional(Schema.String),
  subtype: Schema.optional(Schema.String),
  is_error: Schema.optional(Schema.Boolean),
  result: Schema.optional(Schema.String),
  usage: Schema.optional(
    Schema.Struct({
      input_tokens: Schema.Number,
      output_tokens: Schema.Number,
    }),
  ),
  total_cost_usd: Schema.optional(Schema.Number),
  errors: Schema.optional(Schema.Array(Schema.Unknown)),
})

export interface ClaudeCodeLineResult {
  /** The session this line belongs to, from any line that carries one. */
  readonly sessionId: string | undefined
  /** Incremental assistant text, from a partial-message delta. */
  readonly delta: string | undefined
  /** A whole assistant message, used only when no deltas arrived. */
  readonly assistantText: string | undefined
  /** The final answer, from a successful `result` event. */
  readonly resultText: string | undefined
  readonly usage: TurnUsage | undefined
  /** A failed `result` event's reason. */
  readonly failure: string | undefined
}

/** One `stream-json` line translated. Unreadable lines are skipped, not failed. */
export const translateLine = (line: string): ClaudeCodeLineResult | undefined => {
  const trimmed = line.trim()
  if (trimmed === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  const delta = decodeOption(TextDeltaEvent)(parsed)
  if (Option.isSome(delta)) {
    return {
      sessionId: delta.value.session_id,
      delta: delta.value.event.delta.text,
      assistantText: undefined,
      resultText: undefined,
      usage: undefined,
      failure: undefined,
    }
  }
  const assistant = decodeOption(AssistantLine)(parsed)
  if (Option.isSome(assistant)) {
    const text = (assistant.value.message.content ?? [])
      .flatMap((block) => (block.type === 'text' && block.text !== undefined ? [block.text] : []))
      .join('')
    if (text === '') {
      return assistant.value.session_id === undefined
        ? undefined
        : {
            sessionId: assistant.value.session_id,
            delta: undefined,
            assistantText: undefined,
            resultText: undefined,
            usage: undefined,
            failure: undefined,
          }
    }
    return {
      sessionId: assistant.value.session_id,
      delta: undefined,
      assistantText: text,
      resultText: undefined,
      usage: undefined,
      failure: undefined,
    }
  }
  const result = decodeOption(ResultLine)(parsed)
  if (Option.isSome(result)) {
    const event = result.value
    const failed =
      event.is_error === true || (event.subtype !== undefined && event.subtype !== 'success')
    if (failed) {
      const message =
        event.errors === undefined
          ? (event.result ?? event.subtype ?? 'Claude Code reported the turn as failed')
          : event.errors.map((error) => String(error)).join('; ')
      return {
        sessionId: event.session_id,
        delta: undefined,
        assistantText: undefined,
        resultText: undefined,
        usage: undefined,
        failure: message,
      }
    }
    const usage =
      event.usage === undefined
        ? undefined
        : {
            input_tokens: event.usage.input_tokens,
            output_tokens: event.usage.output_tokens,
            total_tokens: event.usage.input_tokens + event.usage.output_tokens,
          }
    return {
      sessionId: event.session_id,
      delta: undefined,
      assistantText: undefined,
      resultText: event.result,
      usage:
        event.total_cost_usd === undefined || usage === undefined
          ? usage
          : { ...usage, cost: event.total_cost_usd },
      failure: undefined,
    }
  }
  const ref = decodeOption(SessionRef)(parsed)
  if (Option.isSome(ref) && ref.value.session_id !== undefined) {
    return {
      sessionId: ref.value.session_id,
      delta: undefined,
      assistantText: undefined,
      resultText: undefined,
      usage: undefined,
      failure: undefined,
    }
  }
  return undefined
}

/**
 * Whether a failed run means the resumed session is gone, so the bridge may
 * retry once fresh. Matches the CLI's own words for an unknown session, never
 * a model answer: this reads stderr and result failures, not assistant text.
 */
export const isResumeUnknown = (output: string): boolean =>
  /resume/iu.test(output) &&
  /unknown session|session not found|no conversation|not found|invalid session|expired/iu.test(
    output,
  )
