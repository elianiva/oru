import { Context, Data, Effect, Option, Stream } from 'effect'
import type * as Items from '@effect-uai/core/Items'
import type * as Toolkit from '@effect-uai/core/Toolkit'
import type * as Turn from '@effect-uai/core/Turn'

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
  readonly icon?: string
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
  steering: 'queue',
  interruption: true,
}

export interface ModelInfo {
  readonly id: string
  readonly label?: string
  readonly provider?: string
  readonly contextWindow?: number
  readonly reasoning?: boolean
  readonly costTier?: 'low' | 'medium' | 'high'
}

/**
 * One turn, in the vocabulary every harness can carry.
 *
 * The members are the ones a harness actually forwards to its provider; thread
 * identity rides alongside them. A field no harness can honor does not belong
 * here — a bridge that cannot forward it would have to drop it silently.
 */
export interface HarnessTurnRequest {
  readonly threadId: string
  readonly history: readonly Items.HistoryItem[]
  readonly model: string
  // oxlint-disable-next-line typescript/no-explicit-any -- Toolkit is variadic over tool records; harness accepts any toolkit
  readonly tools?: Toolkit.Toolkit<any>
  readonly temperature?: number
  readonly maxOutputTokens?: number
}

export type { Turn } from '@effect-uai/core/Turn'
export type HarnessEvent = Turn.TurnEvent

/** The unified harness interface. Kernel code depends only on this token. Every harness implements the same interface. Swapping harnesses is swapping the Layer that provides this service. */
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

/** Collect a `streamTurn` into a single `Turn`. */
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

const noModels: readonly ModelInfo[] = []

/** Define a harness bridge. */
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
  if (spec.steer !== undefined) service.steer = spec.steer
  if (spec.abort !== undefined) service.abort = spec.abort
  if (spec.health !== undefined) service.health = spec.health
  if (spec.usage !== undefined) service.usage = spec.usage
  return service
}
