import { Context, Data, Effect, Match, Option, Ref, Schema, Stream } from 'effect'
import { defineContributionKind, type ContributionKind } from '@oru/kernel'

export class HarnessError extends Data.TaggedError('HarnessError')<{
  readonly message: string
  readonly code?: string
  readonly retryable?: boolean
  readonly cause?: unknown
}> {}

export interface HarnessMeta {
  readonly id: string
  readonly label: string
  readonly version?: string
  /**
   * The harness's glyph as a lowercase Lucide key (`terminal`, `sparkles`).
   * A key, never a component: it crosses the RPC seam as JSON, and the
   * presentation facet resolves it, falling back to a generic glyph for a key
   * it does not know.
   */
  readonly icon?: string
}

/**
 * A provider behind a harness's catalogue: the tab a picker shows for it.
 *
 * The harness names what it offers; the presentation facet renders it. `icon`
 * follows the same contract as `HarnessMeta.icon`: a lowercase Lucide key the
 * presentation facet resolves, with its own fallback when the harness names
 * none or the key is unknown. A harness that cannot list providers leaves
 * the whole member absent rather than guessing.
 */
export const ProviderInfo = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  icon: Schema.optionalKey(Schema.String),
})
export type ProviderInfo = typeof ProviderInfo.Type

/** `deepseek` stays `Deepseek`; `github-copilot` becomes `Github Copilot`. */
export const fallbackProviderLabel = (id: string): string =>
  id
    .split(/[-_]+/u)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')

/**
 * The catalogue's distinct providers in first-appearance order, with fallback
 * labels and no glyphs. A harness with curated metadata maps over this;
 * one without it returns this directly.
 */
export const providerInfosOf = (
  models: ReadonlyArray<Pick<ModelInfo, 'provider'>>,
): ProviderInfo[] => {
  const seen = new Map<string, ProviderInfo>()
  for (const model of models) {
    const id = model.provider ?? 'unknown'
    if (!seen.has(id)) seen.set(id, { id, label: fallbackProviderLabel(id) })
  }
  return [...seen.values()]
}

/** What a harness can do. Additive and capability-gated. */
export interface HarnessCapabilities {
  /** Can list available models before streaming. */
  readonly modelListing: boolean
  /** Streaming is always true for the current generation, kept explicit for future batch-only harnesses. */
  readonly streaming: boolean
  /** Tool calls (function_call items) round-trip. */
  readonly tools: boolean
  /** Image blocks in history. */
  readonly images: boolean
  /** Extended thinking / reasoning deltas. */
  readonly reasoning: boolean
  /** Session restore / resume across process restarts (bb: sessionRestore). */
  readonly sessionRestore: boolean
  /**
   * The harness owns the conversation. `request.history` seeds its session when
   * it has none for the thread, and the harness's own state is authoritative
   * afterwards, so the session log becomes its trace rather than its memory
   * (ADR-0006).
   */
  readonly ownsHistory: boolean
  /** Steering mode, mirrors bb steerMode but local to the harness. */
  readonly steering: 'queue' | 'inject' | false
  /** Whether an in-flight turn can be interrupted (thread/stop { interrupt }). */
  readonly interruption: boolean
}

export const defaultCapabilities: HarnessCapabilities = {
  modelListing: true,
  streaming: true,
  tools: true,
  images: false,
  reasoning: false,
  sessionRestore: false,
  ownsHistory: false,
  steering: 'queue',
  interruption: true,
}

/**
 * A model a harness can run. The reasoning vocabulary is pi's
 * (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`) because that is the
 * widest one any of these agents speak; a harness that speaks a narrower set
 * lists only what it can honor, and a harness with no reasoning at all lists
 * none.
 */
export const ModelInfo = Schema.Struct({
  id: Schema.NonEmptyString,
  label: Schema.optionalKey(Schema.String),
  provider: Schema.optionalKey(Schema.String),
  contextWindow: Schema.optionalKey(Schema.Number),
  reasoning: Schema.optionalKey(Schema.Boolean),
  costTier: Schema.optionalKey(Schema.Literals(['low', 'medium', 'high'])),
  reasoningLevels: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  /** The harness's own default, when it has one. */
  isDefault: Schema.optionalKey(Schema.Boolean),
})
export type ModelInfo = typeof ModelInfo.Type

// ---------------------------------------------------------------------------
// History: oru's own turn vocabulary. No provider SDK types cross this seam.
// ---------------------------------------------------------------------------

/** An image block carried inside a user message. */
export interface HistoryImage {
  readonly data: string
  readonly mimeType: string
}

export interface UserMessage {
  readonly type: 'user_message'
  readonly text: string
  readonly images?: readonly HistoryImage[]
}

export interface AssistantMessage {
  readonly type: 'assistant_message'
  readonly text: string
}

export interface ReasoningItem {
  readonly type: 'reasoning'
  readonly text: string
}

export interface ToolCallItem {
  readonly type: 'function_call'
  readonly call_id: string
  readonly name: string
  /** Canonical JSON text of the call arguments. */
  readonly arguments: string
}

export interface ToolResultItem {
  readonly type: 'tool_result'
  readonly call_id: string
  readonly output: string
}

/**
 * One history unit a harness forwards to its provider. Thread identity and
 * the working directory ride the request beside this, never inside it.
 */
export type HistoryItem =
  | UserMessage
  | AssistantMessage
  | ReasoningItem
  | ToolCallItem
  | ToolResultItem

export const userText = (text: string, images?: readonly HistoryImage[]): HistoryItem =>
  images === undefined || images.length === 0
    ? { type: 'user_message', text }
    : { type: 'user_message', text, images }

export const assistantText = (text: string): HistoryItem => ({ type: 'assistant_message', text })

export const reasoningText = (text: string): HistoryItem => ({ type: 'reasoning', text })

export const toolCallOutput = (call_id: string, output: string): HistoryItem => ({
  type: 'tool_result',
  call_id,
  output,
})

export const isUserMessage = (item: HistoryItem): item is UserMessage =>
  item.type === 'user_message'

export const isAssistantMessage = (item: HistoryItem): item is AssistantMessage =>
  item.type === 'assistant_message'

export const isToolCall = (item: HistoryItem): item is ToolCallItem => item.type === 'function_call'

export const isToolCallOutput = (item: HistoryItem): item is ToolResultItem =>
  item.type === 'tool_result'

/** The usage bag a completed turn reports. Extra provider fields are dropped. */
export interface TurnUsage {
  readonly input_tokens?: number
  readonly output_tokens?: number
  readonly total_tokens?: number
  readonly cost?: number
}

/** A turn the assembler finished: the items in presentation order plus usage. */
export interface AssembledTurn {
  readonly items: readonly HistoryItem[]
  readonly usage?: TurnUsage
  readonly stop_reason?: string
}

// ---------------------------------------------------------------------------
// Deltas: the narrow grammar a bridge speaks. The assembler owns the timeline.
// ---------------------------------------------------------------------------

/**
 * Session-level facts a turn-scoped delta cannot express. The harness reports;
 * the runtime records what has a home in the log.
 */
export type HarnessEvent = Data.TaggedEnum<{
  /** Streamed assistant text. Assembler accumulates per turn. */
  TextDelta: { readonly text: string }
  /** Streamed reasoning text. */
  ReasoningDelta: { readonly text: string }
  /** A tool call started. */
  ToolCallStart: { readonly call_id: string; readonly name: string }
  /** Partial arguments for a call. Assembler concatenates per call id. */
  ToolCallArgsDelta: { readonly call_id: string; readonly delta: string }
  /** The turn finished. Carries the full item list in presentation order. */
  TurnComplete: { readonly turn: AssembledTurn }
  CompactionStarted: { readonly automatic: boolean }
  /** Carries enough to write an honest `thread/compacted` fact. */
  CompactionEnded: {
    readonly automatic: boolean
    readonly summary: string
    readonly tokensBefore: number
    readonly readFiles: readonly string[]
    readonly modifiedFiles: readonly string[]
  }
  ContextWindow: { readonly tokens: number; readonly contextWindow: number }
  /**
   * The model's memory changed underneath a live thread: a configuration
   * change rebuilt the session, or the thread was forked.
   */
  SessionReplaced: { readonly reason: string }
  /** A tool the harness ran itself, so the runtime can record it as a fact. */
  ToolResult: {
    readonly call_id: string
    readonly name: string
    readonly ok: boolean
    readonly result: string
  }
  ProviderWarning: { readonly message: string }
  ProviderError: { readonly message: string; readonly retryable: boolean }
  /** A provider event the bridge did not understand. Retained, not dropped. */
  RawUnhandled: { readonly type: string; readonly payload: string }
}>

export const HarnessEvent = Data.taggedEnum<HarnessEvent>()

/** Back-compat alias: lifecycle is now the whole vocabulary, not half of it. */
export const HarnessLifecycle = HarnessEvent
export type HarnessLifecycle = HarnessEvent

export const HarnessStatus = Schema.Literals([
  'ready',
  'not_installed',
  'unauthenticated',
  'unsupported_version',
  'unknown',
])
export type HarnessStatus = typeof HarnessStatus.Type

/** What a harness needs before it can run. Reported, never acted on (ADR-0007). */
export const HarnessHealth = Schema.Struct({
  status: HarnessStatus,
  message: Schema.optionalKey(Schema.String),
  installedVersion: Schema.optionalKey(Schema.String),
  minimumSupportedVersion: Schema.optionalKey(Schema.String),
  /** The command the user runs to fix it. oru reports; it does not run it. */
  installCommand: Schema.optionalKey(Schema.String),
})
export type HarnessHealth = typeof HarnessHealth.Type

export const explanationOfHealth = (health: HarnessHealth): string => {
  const message = health.message ?? health.status
  return health.installCommand === undefined ? message : `${message}. Run: ${health.installCommand}`
}

/** A harness's own checkpoint, opaque to the runtime. */
export interface HarnessForkRequest {
  readonly sourceThreadId: string
  readonly targetThreadId: string
  /** Absent means the source thread's newest checkpoint. */
  readonly checkpoint?: string
  /** The new thread's working directory, for a cwd-bound harness. */
  readonly cwd?: string
}

export interface HarnessCompactRequest {
  readonly threadId: string
  readonly instructions?: string
}

export interface HarnessCompaction {
  readonly summary: string
  readonly tokensBefore: number
  readonly readFiles: readonly string[]
  readonly modifiedFiles: readonly string[]
}

/**
 * One turn, in the vocabulary every harness can carry.
 *
 * The members are the ones a harness actually forwards to its provider. Thread
 * identity and the thread's working directory are carried in the same request
 * but are not provider-facing. A field no harness can honor does not belong
 * here: a bridge that cannot forward it would have to drop it silently.
 */
export interface HarnessTurnRequest {
  readonly threadId: string
  readonly history: readonly HistoryItem[]
  readonly model: string | undefined
  readonly tools?: readonly ToolContributionLike[]
  readonly temperature?: number
  readonly maxOutputTokens?: number
  /** The thread's working directory. An agent-run harness is cwd-bound. */
  readonly cwd?: string
  /** Thread instructions, prepended to the harness's own system prompt. */
  readonly instructions?: string
  /** Reasoning level for this turn, one of the chosen model's levels. */
  readonly reasoning?: string
  /**
   * Run one of the thread's tools by name. A bridge executes oru tools only
   * through this callback, never through a provider SDK. The runtime pairs a
   * call the harness ran (reported as `ToolResult`) with its output and
   * records both; a call without an output stays the runtime's own work.
   */
  readonly executeTool?: (input: {
    readonly name: string
    readonly argumentsJson: string
  }) => Promise<{ readonly ok: boolean; readonly result: string }>
  /**
   * Block a harness-run tool until the session log has a decision for this
   * provider request id. Native tools wait in the runtime drain instead.
   */
  readonly awaitToolApproval?: (input: {
    readonly request: string
    readonly call: string
    readonly name: string
    readonly arguments: string
  }) => Promise<'approve' | 'deny'>
}

/**
 * A tool the thread can run, as the harness sees it. `parameters` is a JSON
 * Schema draft-2020-12 document; the bridge renders it into its provider's
 * own tool shape at the boundary.
 */
export interface ToolContributionLike {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
}

/** A harness as a contribution, with the plugin that put it there. */
export interface HarnessEntry {
  readonly plugin: string
  readonly harness: HarnessService
}

/**
 * The host's own selection for a thread nobody has configured, resolved from
 * the host config (ADR-0012). A harness plugin is generic and never reads the
 * host's settings, so the host hands this to the registry when it is built.
 * Absent members leave the choice to the harness: the first registered harness,
 * or its own default model.
 */
export interface HarnessDefaults {
  readonly harness?: string | undefined
  readonly model?: string | undefined
}

/**
 * The token for this contribution kind. Several harness plugins contribute
 * under it at once, so a host can register many bridges without colliding on a
 * service token (ADR-0006).
 */
export const HarnessKind: ContributionKind<HarnessService> =
  defineContributionKind<HarnessService>('oru/harness')

/**
 * The live answer to "which harnesses does this host have". A consumer reads
 * it per call, so activating or deactivating a harness changes the answer
 * without a restart.
 */
export interface HarnessesContract {
  readonly list: () => Effect.Effect<readonly HarnessEntry[]>
  readonly get: (id: string) => Effect.Effect<Option.Option<HarnessEntry>>
  /**
   * The harness an unconfigured thread runs: the host's configured default when
   * it is registered, otherwise the first by plugin id, so the answer is always
   * deterministic.
   */
  readonly preferred: () => Effect.Effect<Option.Option<HarnessEntry>>
  /** The host's own default selection, for the model fallback and the picker. */
  readonly defaults: () => HarnessDefaults
}

export class Harnesses extends Context.Service<Harnesses, HarnessesContract>()('oru/harnesses') {}

/** The unified harness interface. Every harness implements the same interface. */
export interface HarnessService {
  readonly meta: HarnessMeta
  readonly capabilities: HarnessCapabilities
  readonly listModels: () => Effect.Effect<readonly ModelInfo[], HarnessError>
  /**
   * The providers behind the catalogue, for pickers that tab by provider.
   * Absent means the harness names providers only inside its models, and the
   * presentation facet falls back to its own labels and glyphs.
   */
  readonly providers?: () => Effect.Effect<readonly ProviderInfo[], HarnessError>
  readonly streamTurn: (request: HarnessTurnRequest) => Stream.Stream<HarnessEvent, HarnessError>
  readonly turn: (request: HarnessTurnRequest) => Effect.Effect<AssembledTurn, HarnessError>
  readonly steer?: (threadId: string, text: string) => Effect.Effect<void, HarnessError>
  readonly abort?: (threadId: string) => Effect.Effect<void, HarnessError>
  /** Release a thread's session without discarding it. Resuming is implicit. */
  readonly stop?: (threadId: string) => Effect.Effect<void, HarnessError>
  /** Release a thread's session and delete whatever the harness kept for it. */
  readonly discard?: (threadId: string) => Effect.Effect<void, HarnessError>
  /** Copy a thread's session, at a checkpoint, into a new thread. */
  readonly fork?: (request: HarnessForkRequest) => Effect.Effect<void, HarnessError>
  readonly compact?: (
    request: HarnessCompactRequest,
  ) => Effect.Effect<HarnessCompaction, HarnessError>
  readonly health?: () => Effect.Effect<HarnessHealth, HarnessError>
  readonly invalidateHealth?: () => Effect.Effect<void>
}

/**
 * `T` with its `readonly` modifiers removed.
 *
 * Contracts declare `readonly` members, but `defineHarness` and the provider
 * bridges assemble their value one member at a time: an optional member is added
 * only when it is present, because `exactOptionalPropertyTypes` treats "absent"
 * and `undefined` as different contracts, and a conditional spread would hide
 * that omission behind an empty object. Build through this view, then hand the
 * finished value back as `T`.
 */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** Collect a `streamTurn` into a single assembled turn. */
export const turnFromStream = (
  stream: Stream.Stream<HarnessEvent, HarnessError>,
): Effect.Effect<AssembledTurn, HarnessError> =>
  Effect.gen(function* () {
    const complete = yield* Ref.make(Option.none<AssembledTurn>())
    yield* stream.pipe(
      Stream.runForEach((event) =>
        Match.value(event).pipe(
          Match.tag('TurnComplete', (event) => Ref.set(complete, Option.some(event.turn))),
          Match.orElse(() => Effect.void),
        ),
      ),
    )
    const turn = yield* Ref.get(complete)
    return yield* Option.match(turn, {
      onNone: () =>
        Effect.fail(
          new HarnessError({
            message: 'stream ended without TurnComplete',
            code: 'incomplete_turn',
          }),
        ),
      onSome: Effect.succeed,
    })
  })

const noModels: readonly ModelInfo[] = []

/** Define a harness bridge. */
export const defineHarness = (spec: {
  readonly meta: HarnessMeta
  readonly capabilities?: Partial<HarnessCapabilities>
  readonly listModels?: () => Effect.Effect<readonly ModelInfo[], HarnessError>
  readonly providers?: () => Effect.Effect<readonly ProviderInfo[], HarnessError>
  readonly streamTurn: (request: HarnessTurnRequest) => Stream.Stream<HarnessEvent, HarnessError>
  readonly turn?: (request: HarnessTurnRequest) => Effect.Effect<AssembledTurn, HarnessError>
  readonly steer?: (threadId: string, text: string) => Effect.Effect<void, HarnessError>
  readonly abort?: (threadId: string) => Effect.Effect<void, HarnessError>
  readonly stop?: (threadId: string) => Effect.Effect<void, HarnessError>
  readonly discard?: (threadId: string) => Effect.Effect<void, HarnessError>
  readonly fork?: (request: HarnessForkRequest) => Effect.Effect<void, HarnessError>
  readonly compact?: (
    request: HarnessCompactRequest,
  ) => Effect.Effect<HarnessCompaction, HarnessError>
  readonly health?: () => Effect.Effect<HarnessHealth, HarnessError>
  readonly invalidateHealth?: () => Effect.Effect<void>
}): HarnessService => {
  const streamTurn = spec.streamTurn
  const service: Mutable<HarnessService> = {
    meta: spec.meta,
    capabilities: { ...defaultCapabilities, ...spec.capabilities },
    listModels: spec.listModels ?? (() => Effect.succeed(noModels)),
    streamTurn,
    turn: spec.turn ?? ((request) => turnFromStream(streamTurn(request))),
  }
  // A capability the harness did not implement stays absent so callers can gate
  // on it; it is added only once it is proven present.
  if (spec.providers !== undefined) service.providers = spec.providers
  if (spec.steer !== undefined) service.steer = spec.steer
  if (spec.abort !== undefined) service.abort = spec.abort
  if (spec.stop !== undefined) service.stop = spec.stop
  if (spec.discard !== undefined) service.discard = spec.discard
  if (spec.fork !== undefined) service.fork = spec.fork
  if (spec.compact !== undefined) service.compact = spec.compact
  if (spec.health !== undefined) service.health = spec.health
  if (spec.invalidateHealth !== undefined) service.invalidateHealth = spec.invalidateHealth
  return service
}
