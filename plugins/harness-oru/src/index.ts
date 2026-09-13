import { Context, Effect, Stream } from 'effect'
import * as AiError from '@effect-uai/core/AiError'
import {
  LanguageModel,
  type CommonRequest,
  type LanguageModelService,
} from '@effect-uai/core/LanguageModel'
import { definePlugin, type PluginContext } from '@oru/kernel'
import {
  HarnessKind,
  HarnessError,
  defineHarness,
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
  // The runtime's log is this harness's memory: it replays history every turn.
  ownsHistory: false,
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
    // The provider is a library, not an installation: once the LanguageModel is
    // resolved there is nothing left to check.
    health: () => Effect.succeed({ status: 'ready' }),
  })

const setup = (ctx: PluginContext) =>
  Effect.gen(function* () {
    const languageModel = yield* LanguageModel
    // Contributed from setup because the service is assembled from a coeffect
    // (ADR-0017), unlike a tool plugin's static payload.
    yield* ctx.contribute(HarnessKind.of(harnessFromLanguageModel(languageModel)))
    return Context.empty()
  })

/**
 * `harness-oru` — the effect-uai harness.
 *
 * Bridges any `LanguageModel` provider (Responses, Anthropic, Gemini, Mistral,
 * Mock) into oru's harness vocabulary. This is the reference implementation
 * that the bridges (pi, claude-code, codex) mirror structurally via
 * `defineHarness`, and the only one that does not own the conversation: the
 * runtime's log is its memory, and every turn replays history through it.
 *
 * ```
 * Model plugin —provides LanguageModel→  harness-oru —contributes→  Harnesses
 * ```
 *
 * Swap to another harness by contributing a different one under `HarnessKind`
 * (`oru/harness-pi`, …) and picking it per thread (ADR-0017, ADR-0019).
 */
export const harnessOruPlugin = definePlugin({
  id: 'oru/harness-oru',
  needs: [LanguageModel],
  server: { setup },
})

export const makeHarnessOruService = harnessFromLanguageModel
