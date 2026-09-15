import { Option, Predicate, Schema } from 'effect'
import * as Items from '@effect-uai/core/Items'
import { serializeValue } from '@effect-uai/core/ToolResult'
import {
  PiAgentMessage,
  PiCompactionData,
  PiToolResultBody,
  decodeOption,
  type PiContentBlock,
  type PiEntry,
  type PiImageBlock,
  type PiModel,
  type PiToolCallBlock,
  type PiUsage,
} from './wire.ts'

/**
 * pi's session entries in, oru's turn vocabulary out.
 *
 * pi owns the run, so the authoritative record of what happened is its own
 * session file: the bridge reads the entries written since the last turn and
 * translates them, in order, into the items the runtime records as facts. The
 * live event stream is for a human watching, not for this.
 */

export const messageOfEntry = (entry: PiEntry): PiAgentMessage | undefined =>
  Option.getOrUndefined(decodeOption(PiAgentMessage)(entry.message))

const textOfBlock = (block: PiContentBlock): string => (block.type === 'text' ? block.text : '')

const textOfContent = (content: readonly PiContentBlock[] | undefined): string =>
  (content ?? []).map(textOfBlock).join('')

/**
 * The text a pi tool result carries. pi answers with `AgentToolResult`, whose
 * `content` holds the blocks the tool produced; a result of any other kind is
 * reported as JSON rather than dropped.
 */
export const toolResultText = (result: typeof Schema.Unknown.Type): string =>
  Option.match(decodeOption(PiToolResultBody)(result), {
    onNone: () => serializeValue(result),
    onSome: (body) => textOfContent(body.content),
  })

/**
 * A tool call's arguments go back to the model as JSON text. A value JSON
 * cannot carry (a cycle, a `bigint`) becomes an empty argument list, which the
 * provider reports as a missing-argument error rather than a protocol fault.
 */
const jsonArguments = (call: PiToolCallBlock): string => {
  try {
    return JSON.stringify(call.arguments ?? {}) ?? '{}'
  } catch {
    return '{}'
  }
}

export interface PiTurnContent {
  readonly items: readonly Items.HistoryItem[]
  readonly compactions: readonly PiCompactionData[]
  /** Entries whose shape this bridge revision does not understand. */
  readonly unreadable: number
}

const itemsOfEntry = (entry: PiEntry, into: Items.HistoryItem[]): boolean => {
  if (entry.type !== 'message') return true
  const message = messageOfEntry(entry)
  if (message === undefined) return false
  if (message.role === 'user') {
    const text = textOfContent(message.content)
    if (text !== '') into.push(Items.userText(text))
    return true
  }
  if (message.role === 'assistant') {
    const content = message.content ?? []
    const calls = content.filter((block) => block.type === 'toolCall')
    const text = content.map(textOfBlock).join('')
    // An assistant message with no tool calls is always an item, text or not:
    // it is what closes the turn. pi ends every run with one, so a run whose
    // last assistant message had no text would otherwise leave the runtime
    // waiting for a response that already happened.
    if (text !== '' || calls.length === 0) into.push(Items.assistantText(text))
    for (const block of content) {
      if (block.type === 'thinking') into.push({ type: 'reasoning', summary: block.thinking })
      if (block.type === 'toolCall') {
        into.push({
          type: 'function_call',
          call_id: block.id,
          name: block.name,
          arguments: jsonArguments(block),
        })
      }
    }
    return true
  }
  if (message.role === 'toolResult') {
    const callId = message.toolCallId
    if (callId === undefined) return false
    into.push(Items.toolCallOutput(callId, textOfContent(message.content)))
    return true
  }
  // bashExecution, custom, compaction and branch summaries: real entries, but
  // none of them is an item the runtime records.
  return true
}

export const turnContentOf = (entries: readonly PiEntry[]): PiTurnContent => {
  const items: Items.HistoryItem[] = []
  const compactions: PiCompactionData[] = []
  let unreadable = 0
  for (const entry of entries) {
    if (!itemsOfEntry(entry, items)) unreadable += 1
    const compaction = compactionOfEntry(entry)
    if (compaction !== undefined) compactions.push(compaction)
  }
  return { items, compactions, unreadable }
}

const ZERO_USAGE: PiUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }
/**
 * The run's total usage: every assistant message in it, summed. pi reports
 * per-message usage and one run is one model turn per message plus every model
 * turn a tool call caused, so the turn's cost is their sum.
 */
export const usageOfEntries = (entries: readonly PiEntry[]): Items.Usage => {
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  let total = 0
  let cost = 0
  let seen = false
  let seenCost = false
  for (const entry of entries) {
    const message = messageOfEntry(entry)
    if (message === undefined || message.role !== 'assistant') continue
    const usage = message.usage ?? ZERO_USAGE
    seen = true
    input += usage.input
    output += usage.output
    cacheRead += usage.cacheRead ?? 0
    cacheWrite += usage.cacheWrite ?? 0
    total += usage.totalTokens ?? usage.input + usage.output
    if (usage.cost !== undefined) {
      seenCost = true
      cost += usage.cost.total
    }
  }
  if (!seen) return {}
  const usage: Items.Usage = {
    input_tokens: input,
    output_tokens: output,
    total_tokens: total,
    input_tokens_details: { cached_tokens: cacheRead, cache_write_tokens: cacheWrite },
  }
  if (seenCost) Object.assign(usage, { cost })
  return usage
}

export const stopReasonOfEntries = (entries: readonly PiEntry[]): Items.StopReason => {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry === undefined) continue
    const message = messageOfEntry(entry)
    if (message === undefined || message.role !== 'assistant') continue
    if (message.stopReason === 'toolUse') return 'tool_calls'
    if (message.stopReason === 'length') return 'max_tokens'
    return 'stop'
  }
  return 'stop'
}

/** The run's error, when pi gave up on it rather than finishing. */
export const failureOfEntries = (entries: readonly PiEntry[]): string | undefined => {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry === undefined) continue
    const message = messageOfEntry(entry)
    if (message === undefined || message.role !== 'assistant') continue
    if (message.stopReason === 'error') {
      return message.errorMessage ?? 'pi reported the turn as failed'
    }
    if (message.stopReason === 'aborted') return 'the turn was aborted'
    return undefined
  }
  return undefined
}

export const compactionOfEntry = (entry: PiEntry): PiCompactionData | undefined => {
  if (entry.type !== 'compaction') return undefined
  return Option.getOrUndefined(
    decodeOption(PiCompactionData)({
      summary: entry.summary,
      tokensBefore: entry.tokensBefore,
      details: entry.details,
    }),
  )
}

/**
 * The user message a turn is prompted with.
 *
 * Only the tail counts. pi owns the loop, so a history that ends with anything
 * else, an assistant answer or a tool result oru ran itself, is a request to
 * respond to something pi has already answered. Re-prompting the older text
 * would duplicate a turn in pi's session, which is why this returns nothing and
 * the bridge fails the turn instead.
 */
const lastUserMessage = (history: readonly Items.HistoryItem[]): Items.Message | undefined => {
  const item = history.at(-1)
  if (item === undefined || !Items.isMessage(item) || item.role !== 'user') return undefined
  return item
}

export const promptTextOf = (history: readonly Items.HistoryItem[]): string | undefined => {
  const message = lastUserMessage(history)
  if (message === undefined) return undefined
  const text = message.content
    .map((block) => (block.type === 'input_text' ? block.text : ''))
    .join('')
  return text === '' ? undefined : text
}

/** The images pi needs alongside that text, in its own content shape. */
export const promptImagesOf = (history: readonly Items.HistoryItem[]): readonly PiImageBlock[] => {
  const message = lastUserMessage(history)
  if (message === undefined) return []
  const images: PiImageBlock[] = []
  for (const block of message.content) {
    if (block.type === 'input_image' && Predicate.isTagged(block.source, 'base64')) {
      images.push({
        type: 'image',
        data: block.source.base64,
        mimeType: block.source.mimeType,
      })
    }
  }
  return images
}

const piContentOf = (item: Items.Message): PiContentBlock[] => {
  const content: PiContentBlock[] = []
  for (const block of item.content) {
    if (block.type === 'input_text' || block.type === 'output_text') {
      content.push({ type: 'text', text: block.text })
    }
    if (block.type === 'input_image' && Predicate.isTagged(block.source, 'base64')) {
      content.push({
        type: 'image',
        data: block.source.base64,
        mimeType: block.source.mimeType,
      })
    }
  }
  return content
}

interface PiAssistantSeed {
  readonly message: PiAgentMessage
  readonly content: PiContentBlock[]
}

/**
 * pi sums `usage.cost.total` over the session for its stats, so a seed without
 * cost crashes `get_session_stats` on real pi: seeded usage carries zero cost.
 */
const SEED_USAGE = {
  ...ZERO_USAGE,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

const seedAssistant = (content: PiContentBlock[]): PiAssistantSeed => ({
  message: {
    role: 'assistant',
    content,
    api: 'oru',
    provider: 'oru',
    model: 'oru',
    usage: SEED_USAGE,
    stopReason: 'stop',
    timestamp: 0,
  },
  content,
})

/**
 * pi stores a tool call's arguments as a JSON value. Decoding through
 * `Schema.Json` means a malformed or exotic payload becomes `{}`, a call with
 * no arguments, instead of a value the seed writer would emit and pi's reader
 * would reject.
 */
const PiToolArguments = Schema.fromJsonString(Schema.Json)
const parseArguments = (argumentsJson: string): typeof PiToolArguments.Type => {
  const decoded = decodeOption(PiToolArguments)(argumentsJson)
  return Option.isSome(decoded) ? decoded.value : {}
}

/**
 * Bootstrap a pi session from oru's history.
 *
 * Only used when the thread has no pi session file, where the runtime's history
 * is all pi has to start from. Two rules keep the seed loadable: a tool call is
 * seeded only when its output is also in the history, because a provider
 * rejects a call with no result, and the trailing user message is left out
 * because it is the prompt the bridge is about to send.
 */
export const piMessagesOfHistory = (
  history: readonly Items.HistoryItem[],
): readonly PiAgentMessage[] => {
  const answered = new Set<string>()
  for (const item of history) {
    if (Items.isToolCallOutput(item)) answered.add(item.call_id)
  }

  const messages: PiAgentMessage[] = []
  let current: PiAssistantSeed | undefined
  const openAssistant = (): PiAssistantSeed => {
    if (current !== undefined) return current
    const opened = seedAssistant([])
    messages.push(opened.message)
    current = opened
    return opened
  }

  for (const item of history) {
    if (Items.isMessage(item)) {
      if (item.role === 'user') {
        const content = piContentOf(item)
        if (content.length > 0) messages.push({ role: 'user', content, timestamp: 0 })
        current = undefined
        continue
      }
      if (item.role === 'assistant') {
        const opened = seedAssistant(piContentOf(item))
        messages.push(opened.message)
        current = opened.content.length > 0 ? opened : undefined
        continue
      }
      continue
    }
    if (Items.isToolCall(item)) {
      if (!answered.has(item.call_id)) continue
      openAssistant().content.push({
        type: 'toolCall',
        id: item.call_id,
        name: item.name,
        arguments: parseArguments(item.arguments),
      })
      continue
    }
    if (Items.isToolCallOutput(item)) {
      messages.push({
        role: 'toolResult',
        toolCallId: item.call_id,
        toolName: 'oru',
        content: [{ type: 'text', text: item.output }],
        isError: false,
        timestamp: 0,
      })
    }
  }

  if (messages.at(-1)?.role === 'user') messages.pop()
  return messages
}

const EXTENDED_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * pi's own rule (`getSupportedThinkingLevels` in `packages/ai/src/models.ts`):
 * a non-reasoning model only offers `off`, `xhigh` and `max` exist only when
 * the model maps them, and a `null` mapping means the level is unsupported.
 */
export const thinkingLevelsOf = (model: PiModel): readonly string[] => {
  if (model.reasoning !== true) return ['off']
  const map = model.thinkingLevelMap
  return EXTENDED_LEVELS.filter((level) => {
    const mapped = map === undefined ? undefined : map[level]
    if (mapped === null) return false
    if (level === 'xhigh' || level === 'max') return mapped !== undefined
    return true
  })
}
