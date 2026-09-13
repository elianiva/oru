import { Context, Effect, Layer, Stream } from 'effect'
import * as AiError from '@effect-uai/core/AiError'
import {
  LanguageModel,
  type CommonRequest,
  type LanguageModelService,
} from '@effect-uai/core/LanguageModel'
import { definePlugin } from '@oru/kernel'
import {
  defineHarness,
  Harness,
  HarnessError,
  type HarnessService,
  type HarnessTurnRequest,
  type ModelInfo,
  type Mutable,
} from '@oru/harness'

export const demoModelId = 'mock'

const meta = {
  id: 'oru',
  label: 'Oru (effect-uai)',
  icon: 'sparkles',
} as const

const capabilities = {
  modelListing: true,
  streaming: true,
  tools: true,
  images: false,
  reasoning: false,
  sessionRestore: false,
  steering: 'queue' as const,
  interruption: true,
}

// Demo catalogue — a real harness-oru would query the provider.
// Keep `mock` first so the inference loop's fallback stays stable.
const catalogue: readonly ModelInfo[] = [
  { id: demoModelId, label: 'Demo (mock)', provider: 'mock', contextWindow: 8192 },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', provider: 'openai', contextWindow: 128_000 },
  {
    id: 'claude-sonnet-4',
    label: 'Claude Sonnet 4',
    provider: 'anthropic',
    contextWindow: 200_000,
    reasoning: true,
  },
] as const

/**
 * Provider failures reach this bridge as the typed `AiError` union, so the tag is
 * already the code and the retry policy is a branch on the domain value — no
 * structural probing of an `unknown` cause.
 */
const isRetryable = (cause: AiError.AiError): boolean =>
  cause._tag === 'RateLimited' || cause._tag === 'Unavailable' || cause._tag === 'Timeout'

const toHarnessError = (cause: AiError.AiError): HarnessError =>
  new HarnessError({
    message: AiError.describe(cause),
    code: cause._tag,
    retryable: isRetryable(cause),
    cause,
  })

/**
 * The harness request is the model request plus thread identity, so forward
 * exactly the members `CommonRequest` declares. Adding an optional member only
 * once it is present keeps "absent" distinct from `undefined`, which the model
 * contract does not accept under `exactOptionalPropertyTypes`.
 */
const toCommonRequest = (request: HarnessTurnRequest): CommonRequest => {
  const common: Mutable<CommonRequest> = { history: request.history, model: request.model }
  if (request.tools !== undefined) common.tools = request.tools
  if (request.temperature !== undefined) common.temperature = request.temperature
  if (request.maxOutputTokens !== undefined) common.maxOutputTokens = request.maxOutputTokens
  return common
}

export const harnessFromLanguageModel = (model: LanguageModelService): HarnessService =>
  defineHarness({
    meta,
    capabilities,
    listModels: () => Effect.succeed(catalogue),
    streamTurn: (request) =>
      model.streamTurn(toCommonRequest(request)).pipe(Stream.mapError(toHarnessError)),
    turn: (request) => model.turn(toCommonRequest(request)).pipe(Effect.mapError(toHarnessError)),
    abort: (threadId: string) =>
      Effect.void.pipe(
        Effect.tap(() =>
          Effect.logDebug(
            `harness-oru: abort requested for thread ${threadId} (no-op, queue-mode steering)`,
          ),
        ),
      ),
    health: () => Effect.succeed({ ok: true }),
  })

const setup = () =>
  Effect.gen(function* () {
    const languageModel = yield* LanguageModel
    const service = harnessFromLanguageModel(languageModel)
    return Context.make(Harness, service)
  })

/**
 * `harness-oru` — the effect-uai harness.
 *
 * Bridges any `LanguageModel` provider (Responses, Anthropic, Gemini, Mistral, Mock)
 * into the unified `Harness` token. This is the reference implementation that
 * other harnesses (pi, claude-code, codex) mirror structurally via `defineHarness`.
 *
 * ```
 * Model plugin —provides LanguageModel→  harness-oru —provides Harness→  inference
 * ```
 *
 * Swap to another harness by providing `Harness` from a different plugin
 * (`harness-pi`, `harness-claude-code`, …) and not loading harness-oru.
 */
export const harnessOruPlugin = definePlugin({
  id: 'oru/harness-oru',
  needs: [LanguageModel],
  provides: [Harness],
  server: { setup },
})

export const HarnessOruLive = (service: LanguageModelService): Layer.Layer<Harness, never, never> =>
  Layer.succeed(Harness, harnessFromLanguageModel(service))

export const makeHarnessOruService = harnessFromLanguageModel
