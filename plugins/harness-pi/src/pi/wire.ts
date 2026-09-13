import { Schema, SchemaGetter } from 'effect'

/**
 * The pi RPC protocol, decoded at the boundary.
 *
 * Everything in here is pi's wire shape, not oru's. It is deliberately
 * permissive: only the fields the bridge reads are required, and a variant the
 * bridge does not understand decodes as `PiOpaque*` or fails the union and is
 * reported as `RawUnhandled` rather than being dropped silently.
 *
 * Field names and shapes come from `packages/coding-agent/docs/rpc.md`,
 * `docs/session-format.md`, and `packages/ai/src/types.ts` in this pi revision.
 */

export const PiUsage = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.optionalKey(Schema.Number),
  cacheWrite: Schema.optionalKey(Schema.Number),
  totalTokens: Schema.optionalKey(Schema.Number),
})
export type PiUsage = typeof PiUsage.Type

const PiTextBlock = Schema.Struct({ type: Schema.Literal('text'), text: Schema.String })
const PiThinkingBlock = Schema.Struct({
  type: Schema.Literal('thinking'),
  thinking: Schema.String,
})
export const PiToolCallBlock = Schema.Struct({
  type: Schema.Literal('toolCall'),
  id: Schema.String,
  name: Schema.String,
  arguments: Schema.optionalKey(Schema.Unknown),
})
export type PiToolCallBlock = typeof PiToolCallBlock.Type
export const PiImageBlock = Schema.Struct({
  type: Schema.Literal('image'),
  data: Schema.String,
  mimeType: Schema.String,
})
export type PiImageBlock = typeof PiImageBlock.Type

export const PiContentBlock = Schema.Union([
  PiTextBlock,
  PiThinkingBlock,
  PiToolCallBlock,
  PiImageBlock,
])
export type PiContentBlock = typeof PiContentBlock.Type

/**
 * What pi reports as a tool's result: an `AgentToolResult`, whose `content` is
 * the blocks the tool answered with.
 */
export const PiToolResultBody = Schema.Struct({
  content: Schema.optionalKey(Schema.Array(PiContentBlock)),
})

/**
 * pi writes a user message's content as either a string or a list of blocks.
 * Decoding normalizes that to blocks, so nothing downstream branches on it.
 */
const PiMessageContent = Schema.Union([Schema.String, Schema.Array(PiContentBlock)]).pipe(
  Schema.decodeTo(Schema.Array(PiContentBlock), {
    decode: SchemaGetter.transform((content: string | readonly PiContentBlock[]) =>
      Array.isArray(content) ? content : [{ type: 'text' as const, text: content }],
    ),
    encode: SchemaGetter.passthrough(),
  }),
)

/**
 * One pi message. Kept as a single permissive struct rather than a union of
 * roles: pi's own roles are open (`bashExecution`, `custom`, summaries), and a
 * role oru does not model must still decode so the bridge can count it.
 */
export const PiAgentMessage = Schema.Struct({
  role: Schema.String,
  content: Schema.optionalKey(PiMessageContent),
  toolCallId: Schema.optionalKey(Schema.String),
  toolName: Schema.optionalKey(Schema.String),
  isError: Schema.optionalKey(Schema.Boolean),
  usage: Schema.optionalKey(PiUsage),
  stopReason: Schema.optionalKey(Schema.String),
  errorMessage: Schema.optionalKey(Schema.String),
  provider: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  api: Schema.optionalKey(Schema.String),
  timestamp: Schema.optionalKey(Schema.Number),
})
export type PiAgentMessage = typeof PiAgentMessage.Type

export const PiEntry = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  timestamp: Schema.String,
  message: Schema.optionalKey(Schema.Unknown),
  summary: Schema.optionalKey(Schema.String),
  tokensBefore: Schema.optionalKey(Schema.Number),
  details: Schema.optionalKey(Schema.Unknown),
})
export type PiEntry = typeof PiEntry.Type

export const PiCompactionDetails = Schema.Struct({
  readFiles: Schema.optionalKey(Schema.Array(Schema.String)),
  modifiedFiles: Schema.optionalKey(Schema.Array(Schema.String)),
})

export const PiCompactionData = Schema.Struct({
  summary: Schema.String,
  firstKeptEntryId: Schema.optionalKey(Schema.String),
  tokensBefore: Schema.Number,
  details: Schema.optionalKey(PiCompactionDetails),
})
export type PiCompactionData = typeof PiCompactionData.Type

/** The payload of a `compact` command: `CompactionResult` in pi's own words. */
export const PiCompactionResult = Schema.Struct({
  summary: Schema.String,
  tokensBefore: Schema.Number,
  firstKeptEntryId: Schema.optionalKey(Schema.String),
  estimatedTokensAfter: Schema.optionalKey(Schema.Number),
})
export type PiCompactionResult = typeof PiCompactionResult.Type

/** The first line of a pi session file, which carries the session's cwd. */
export const PiSessionFileHeader = Schema.Struct({
  type: Schema.Literal('session'),
  id: Schema.String,
  timestamp: Schema.String,
  cwd: Schema.optionalKey(Schema.String),
})
export type PiSessionFileHeader = typeof PiSessionFileHeader.Type

export const PiStateData = Schema.Struct({
  model: Schema.NullOr(
    Schema.Struct({
      provider: Schema.String,
      id: Schema.String,
      contextWindow: Schema.optionalKey(Schema.Number),
    }),
  ),
  thinkingLevel: Schema.optionalKey(Schema.String),
  sessionFile: Schema.optionalKey(Schema.String),
})
export type PiStateData = typeof PiStateData.Type

export const PiModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  provider: Schema.optionalKey(Schema.String),
  reasoning: Schema.optionalKey(Schema.Boolean),
  contextWindow: Schema.optionalKey(Schema.Number),
  thinkingLevelMap: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
})
export type PiModel = typeof PiModel.Type

export const PiModelsData = Schema.Struct({ models: Schema.Array(PiModel) })

export const PiEntriesData = Schema.Struct({
  entries: Schema.Array(PiEntry),
  leafId: Schema.NullOr(Schema.String),
})
export type PiEntriesData = typeof PiEntriesData.Type

export const PiForkData = Schema.Struct({ sessionFile: Schema.String })

export const PiSessionStatsData = Schema.Struct({
  contextUsage: Schema.optionalKey(
    Schema.Struct({
      tokens: Schema.NullOr(Schema.Number),
      contextWindow: Schema.Number,
    }),
  ),
})

const PiResponseEnvelope = Schema.Struct({
  type: Schema.Literal('response'),
  id: Schema.optionalKey(Schema.String),
  command: Schema.String,
  success: Schema.Boolean,
  data: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.String),
})
export type PiResponseEnvelope = typeof PiResponseEnvelope.Type

const PiUiRequest = Schema.Struct({
  type: Schema.Literal('extension_ui_request'),
  id: Schema.String,
  method: Schema.String,
})
export type PiUiRequest = typeof PiUiRequest.Type

/** pi's interactive dialogs: it waits for an answer, so the bridge must send one. */
export const PI_DIALOG_METHODS: readonly string[] = ['select', 'confirm', 'input', 'editor']

/** Any JSON object with a type field, the fallback for a variant oru cannot read. */
const PiTypedLine = Schema.Struct({ type: Schema.String })

// ---------------------------------------------------------------------------
// Streaming deltas
// ---------------------------------------------------------------------------

/** text_start, thinking_start/_end, toolcall_end and anything newer. */
export const PiAssistantMessageEvent = Schema.Struct({
  type: Schema.String,
  delta: Schema.optionalKey(Schema.String),
  id: Schema.optionalKey(Schema.String),
  toolName: Schema.optionalKey(Schema.String),
  contentIndex: Schema.optionalKey(Schema.Number),
})
export type PiAssistantMessageEvent = typeof PiAssistantMessageEvent.Type

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const PiAgentStart = Schema.Struct({ type: Schema.Literal('agent_start') })
const PiAgentEnd = Schema.Struct({
  type: Schema.Literal('agent_end'),
  willRetry: Schema.optionalKey(Schema.Boolean),
})
const PiAgentSettled = Schema.Struct({ type: Schema.Literal('agent_settled') })
const PiMessageUpdate = Schema.Struct({
  type: Schema.Literal('message_update'),
  assistantMessageEvent: PiAssistantMessageEvent,
})
const PiToolExecutionStart = Schema.Struct({
  type: Schema.Literal('tool_execution_start'),
  toolCallId: Schema.String,
  toolName: Schema.String,
})
const PiToolExecutionEnd = Schema.Struct({
  type: Schema.Literal('tool_execution_end'),
  toolCallId: Schema.String,
  toolName: Schema.String,
  result: Schema.optionalKey(Schema.Unknown),
  isError: Schema.optionalKey(Schema.Boolean),
})
const PiCompactionStart = Schema.Struct({
  type: Schema.Literal('compaction_start'),
  reason: Schema.optionalKey(Schema.String),
})
const PiCompactionEnd = Schema.Struct({
  type: Schema.Literal('compaction_end'),
  reason: Schema.optionalKey(Schema.String),
  result: Schema.NullOr(PiCompactionData),
  aborted: Schema.optionalKey(Schema.Boolean),
  errorMessage: Schema.optionalKey(Schema.String),
})
const PiAutoRetryStart = Schema.Struct({
  type: Schema.Literal('auto_retry_start'),
  attempt: Schema.optionalKey(Schema.Number),
  maxAttempts: Schema.optionalKey(Schema.Number),
  errorMessage: Schema.optionalKey(Schema.String),
})
const PiAutoRetryEnd = Schema.Struct({
  type: Schema.Literal('auto_retry_end'),
  success: Schema.optionalKey(Schema.Boolean),
  attempt: Schema.optionalKey(Schema.Number),
  finalError: Schema.optionalKey(Schema.String),
})
const PiExtensionError = Schema.Struct({
  type: Schema.Literal('extension_error'),
  event: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
})

export const PiEvent = Schema.Union([
  PiAgentStart,
  PiAgentEnd,
  PiAgentSettled,
  PiMessageUpdate,
  PiToolExecutionStart,
  PiToolExecutionEnd,
  PiCompactionStart,
  PiCompactionEnd,
  PiAutoRetryStart,
  PiAutoRetryEnd,
  PiExtensionError,
]).pipe(Schema.toTaggedUnion('type'))
export type PiEvent = typeof PiEvent.Type

/**
 * An event line: either a variant the bridge understands, or the type name and
 * raw line of one it does not. Understood-ness is decided at the protocol
 * boundary so nothing downstream re-inspects an unparsed value.
 */
export const PiEventSeen = Schema.TaggedStruct('event', { event: PiEvent })

/** A line whose type the bridge does not model, kept whole for the model. */
export const PiRawLineSeen = Schema.TaggedStruct('raw', {
  type: Schema.String,
  raw: Schema.String,
})

const PiEventMessage = Schema.Union([PiEventSeen, PiRawLineSeen])
export type PiEventMessage = typeof PiEventMessage.Type

// ---------------------------------------------------------------------------
// The extension channel
// ---------------------------------------------------------------------------

const PiChannelReady = Schema.Struct({
  kind: Schema.Literal('ready'),
  registeredTools: Schema.optionalKey(Schema.Array(Schema.String)),
  activeTools: Schema.optionalKey(Schema.Array(Schema.String)),
})
const PiChannelModelScope = Schema.Struct({
  kind: Schema.Literal('model-scope'),
  scopedModelIds: Schema.optionalKey(Schema.Array(Schema.String)),
  defaultModelId: Schema.NullOr(Schema.String),
})
const PiChannelLeaf = Schema.Struct({
  kind: Schema.Literal('leaf'),
  leafId: Schema.NullOr(Schema.String),
})
const PiChannelToolCall = Schema.Struct({
  kind: Schema.Literal('tool-call'),
  id: Schema.String,
  toolName: Schema.String,
  /** The arguments as JSON text, exactly as they go back out to the model. */
  arguments: Schema.optionalKey(Schema.String),
})
export const PiChannelReply = Schema.Struct({
  kind: Schema.Literal('reply'),
  id: Schema.String,
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.String),
})
export type PiChannelReply = typeof PiChannelReply.Type

export const PiChannelMessage = Schema.Union([
  PiChannelReady,
  PiChannelModelScope,
  PiChannelLeaf,
  PiChannelToolCall,
  PiChannelReply,
])
export type PiChannelMessage = typeof PiChannelMessage.Type

/** `Schema.decodeUnknownOption`, aliased: every wire read goes through it. */
export const decodeOption = Schema.decodeUnknownOption

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/**
 * Line codecs. Decoding straight from the line keeps JSON parsing at the same
 * boundary as shape validation, so no unparsed value ever crosses into the
 * bridge's own code.
 */
export const PiResponseLine = Schema.fromJsonString(PiResponseEnvelope)
export const PiUiRequestLine = Schema.fromJsonString(PiUiRequest)
export const PiEventLine = Schema.fromJsonString(PiEvent)
export const PiChannelLine = Schema.fromJsonString(PiChannelMessage)
export const PiTypedLineReader = Schema.fromJsonString(PiTypedLine)
export const PiArgsEnv = Schema.fromJsonString(Schema.Array(Schema.String))
export const PiSessionHeaderLine = Schema.fromJsonString(PiSessionFileHeader)
