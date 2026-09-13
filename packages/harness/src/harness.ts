import { Context, Data, Effect, Option, Stream } from 'effect'
import type * as Items from '@effect-uai/core/Items'
import type * as Tool from '@effect-uai/core/Tool'
import type * as Toolkit from '@effect-uai/core/Toolkit'
import type * as Turn from '@effect-uai/core/Turn'

// ── Errors ────────────────────────────────────────────────────────────────

export class HarnessError extends Data.TaggedError('HarnessError')<{
  readonly message: string
  readonly code?: string
  readonly retryable?: boolean
  readonly cause?: unknown
}> {}

// ── Meta & Capabilities ─────────────────────────────────────────────────

export interface HarnessMeta {
  readonly id: string
  readonly label: string
  readonly version?: string
  readonly icon?: string
}

/**
 * What a harness can do. Additive, capability-gated.
 * Mirrors bb's BridgeCapabilities (sessionRestore, steerMode, etc.)
 * but harness-native and effect-typed.
 */
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
  /** Steering mode — mirrors bb's steerMode but local to the harness. */
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
  steering: 'queue',
  interruption: true,
}

// ── Models ──────────────────────────────────────────────────────────────

export interface ModelInfo {
  readonly id: string
  readonly label?: string
  readonly provider?: string
  readonly contextWindow?: number
  readonly reasoning?: boolean
  readonly costTier?: 'low' | 'medium' | 'high'
}

// ── Request ─────────────────────────────────────────────────────────────

export interface HarnessTurnRequest {
  readonly threadId: string
  readonly history: readonly Items.HistoryItem[]
  readonly model: string
  // oxlint-disable-next-line typescript/no-explicit-any -- Toolkit is variadic over tool records; harness accepts any toolkit
  readonly tools?: Toolkit.Toolkit<any>
  /** Raw descriptors, alternative to Toolkit when the caller already rendered. */
  readonly toolDescriptors?: readonly Tool.ToolDescriptor[]
  readonly temperature?: number
  readonly maxOutputTokens?: number
  readonly reasoningLevel?: string
  readonly instructions?: string
  /** Opaque provider options forwarded verbatim (e.g. serviceTier, effort, promptMode). */
  readonly providerOptions?: Record<string, unknown>
}

// Re-export TurnEvent / Turn for consumers so they don't import @effect-uai directly
export type { Turn } from '@effect-uai/core/Turn'
export type HarnessEvent = Turn.TurnEvent

// ── Service ─────────────────────────────────────────────────────────────

/**
 * The unified harness surface. Kernel code depends only on this token.
 *
 * Every harness — oru (effect-uai), pi, claude-code, codex, acp — implements
 * the same interface. Swapping harnesses is swapping the Layer that provides
 * this service; the inference plugin and the rest of the kernel stay unchanged.
 *
 * Design notes:
 * - Effect-native: every method returns Effect or Stream, errors are HarnessError.
 * - Plugin-first: a harness is a normal oru plugin that `provides: [Harness]`.
 * - Minimal core + additive capabilities: unknown capabilities are ignored, new
 *   methods are optional and gated by `capabilities`.
 * - Streaming is the primitive; `turn` is derived via TurnComplete.
 */
export interface HarnessService {
  readonly meta: HarnessMeta
  readonly capabilities: HarnessCapabilities
  readonly listModels: () => Effect.Effect<readonly ModelInfo[], HarnessError>
  readonly streamTurn: (request: HarnessTurnRequest) => Stream.Stream<HarnessEvent, HarnessError>
  readonly turn: (request: HarnessTurnRequest) => Effect.Effect<Turn.Turn, HarnessError>
  readonly steer?: (threadId: string, text: string) => Effect.Effect<void, HarnessError>
  readonly abort?: (threadId: string) => Effect.Effect<void, HarnessError>
  readonly health?: () => Effect.Effect<{ ok: boolean; message?: string }, HarnessError>
  readonly usage?: () => Effect.Effect<unknown, HarnessError>
}

export class Harness extends Context.Service<Harness, HarnessService>()('oru/harness') {}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Collect a `streamTurn` into a single `Turn`. Mirrors `turnFromStream` in effect-uai.
 */
export const turnFromStream = (
  stream: Stream.Stream<HarnessEvent, HarnessError>,
): Effect.Effect<Turn.Turn, HarnessError> =>
  stream.pipe(
    Stream.filter((event) => event._tag === 'TurnComplete'),
    Stream.runHead,
    Effect.flatMap((head) =>
      Option.match(head, {
        onNone: () =>
          Effect.fail(
            new HarnessError({
              message: 'stream ended without TurnComplete',
              code: 'incomplete_turn',
            }),
          ),
        onSome: (event) => Effect.succeed(event.turn),
      }),
    ),
  )

// ── Bridge factory ──────────────────────────────────────────────────────

/**
 * Define a harness bridge — the authoring surface for a Harness.
 *
 * Mirrors bb's `experimental_defineProviderBridge({ handleLine, start })` but
 * effect-native and Harness-typed: a single `defineHarness` call declares the
 * harness's identity, capabilities, and the Effect/Stream handlers the kernel
 * will drive. Import this from `@oru/harness` in any harness implementation
 * (oru, pi, claude-code, codex).
 *
 * ```ts
 * import { defineHarness, defaultCapabilities } from '@oru/harness'
 * import { Stream, Effect } from 'effect'
 *
 * export const myHarness = defineHarness({
 *   meta: { id: 'my', label: 'My harness' },
 *   capabilities: { ...defaultCapabilities, steering: 'inject' },
 *   listModels: () => Effect.succeed([{ id: 'model-a' }]),
 *   streamTurn: (req) => Stream.make(TurnEvent.TextDelta({ text: 'hi' }), ...),
 * })
 * ```
 */
export const defineHarness = (spec: {
  readonly meta: HarnessMeta
  readonly capabilities?: Partial<HarnessCapabilities>
  readonly listModels?: () => Effect.Effect<readonly ModelInfo[], HarnessError>
  readonly streamTurn: (request: HarnessTurnRequest) => Stream.Stream<HarnessEvent, HarnessError>
  readonly turn?: (request: HarnessTurnRequest) => Effect.Effect<Turn.Turn, HarnessError>
  readonly steer?: (threadId: string, text: string) => Effect.Effect<void, HarnessError>
  readonly abort?: (threadId: string) => Effect.Effect<void, HarnessError>
  readonly health?: () => Effect.Effect<{ ok: boolean; message?: string }, HarnessError>
  readonly usage?: () => Effect.Effect<unknown, HarnessError>
}): HarnessService => {
  const capabilities: HarnessCapabilities = { ...defaultCapabilities, ...spec.capabilities }
  const listModels = spec.listModels ?? (() => Effect.succeed([] as readonly ModelInfo[]))
  const streamTurn = spec.streamTurn
  const turn = spec.turn ?? ((request: HarnessTurnRequest) => turnFromStream(streamTurn(request)))
  // SAFETY: HarnessService is a plain record; extra keys are fine
  return {
    meta: spec.meta,
    capabilities,
    listModels,
    streamTurn,
    turn,
    ...(spec.steer === undefined ? {} : { steer: spec.steer }),
    ...(spec.abort === undefined ? {} : { abort: spec.abort }),
    ...(spec.health === undefined ? {} : { health: spec.health }),
    ...(spec.usage === undefined ? {} : { usage: spec.usage }),
  }
}
