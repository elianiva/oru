import { Context, Effect, Layer, Stream } from 'effect'
import {
  LanguageModel,
  type CommonRequest,
  type LanguageModelService,
} from '@effect-uai/core/LanguageModel'
import { definePlugin, type PluginContext } from '@oru/kernel'
import {
  defineHarness,
  Harness,
  HarnessError,
  type HarnessService,
  type HarnessTurnRequest,
  type ModelInfo,
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

interface MaybeAiError {
  readonly _tag?: string
  readonly message?: string
  readonly code?: string
  readonly retryable?: boolean
}

const asMaybeAiError = (cause: unknown): MaybeAiError =>
  typeof cause === 'object' && cause !== null ? (cause as MaybeAiError) : {}

const mapAiError = (cause: unknown): HarnessError => {
  if (cause instanceof HarnessError) return cause
  const anyCause = asMaybeAiError(cause)
  const message =
    typeof anyCause.message === 'string' && anyCause.message.length > 0
      ? anyCause.message
      : String(cause)
  const retryable = typeof anyCause.retryable === 'boolean' ? anyCause.retryable : undefined
  const base = { message, cause } as const
  if (typeof anyCause.code === 'string') {
    if (retryable !== undefined)
      return new HarnessError({ ...base, code: anyCause.code, retryable })
    return new HarnessError({ ...base, code: anyCause.code })
  }
  if (typeof anyCause._tag === 'string') {
    if (retryable !== undefined)
      return new HarnessError({ ...base, code: anyCause._tag, retryable })
    return new HarnessError({ ...base, code: anyCause._tag })
  }
  if (retryable !== undefined) return new HarnessError({ ...base, retryable })
  return new HarnessError(base)
}

export const harnessFromLanguageModel = (model: LanguageModelService): HarnessService =>
  defineHarness({
    meta,
    capabilities,
    listModels: () => Effect.succeed(catalogue),
    streamTurn: (request: HarnessTurnRequest) => {
      const common: Record<string, unknown> = {
        history: request.history,
        model: request.model,
      }
      if (request.tools !== undefined) common['tools'] = request.tools
      if (request.toolDescriptors !== undefined) common['toolDescriptors'] = request.toolDescriptors
      if (request.temperature !== undefined) common['temperature'] = request.temperature
      if (request.maxOutputTokens !== undefined) common['maxOutputTokens'] = request.maxOutputTokens
      if (request.reasoningLevel !== undefined) common['reasoningLevel'] = request.reasoningLevel
      if (request.instructions !== undefined) common['instructions'] = request.instructions
      if (request.providerOptions !== undefined) common['providerOptions'] = request.providerOptions
      return model.streamTurn(common as CommonRequest).pipe(Stream.mapError(mapAiError))
    },
    turn: (request: HarnessTurnRequest) => {
      const common: Record<string, unknown> = {
        history: request.history,
        model: request.model,
      }
      if (request.tools !== undefined) common['tools'] = request.tools
      if (request.toolDescriptors !== undefined) common['toolDescriptors'] = request.toolDescriptors
      if (request.temperature !== undefined) common['temperature'] = request.temperature
      if (request.maxOutputTokens !== undefined) common['maxOutputTokens'] = request.maxOutputTokens
      if (request.providerOptions !== undefined) common['providerOptions'] = request.providerOptions
      return model.turn(common as CommonRequest).pipe(Effect.mapError(mapAiError))
    },
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

const setup = (ctx: PluginContext<readonly [typeof LanguageModel]>) =>
  Effect.sync(function () {
    const languageModel = ctx.service(LanguageModel)
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
