import { createRequire } from 'node:module'
import { Effect, Option, Schema } from 'effect'
import { Model } from '@opencode/schema/model'
import {
  fallbackProviderLabel,
  type HarnessError,
  type HarnessHealth,
  type ModelInfo,
  type Mutable,
  type ProviderInfo,
} from '@oru/harness'
import { bridgeError } from './errors.ts'
import type { OpenCodePort } from './port.ts'

/**
 * The catalogue behind the picker: OpenCode's models and providers, mapped to
 * oru's vocabulary and memoized briefly, because the picker asks often and the
 * catalogue changes when the user signs in, not between two frames.
 *
 * A `ModelInfo.id` is always `provider/model`: that string parses back into a
 * `Model.Ref` exactly, so whatever the picker hands back round-trips into
 * `session.switchModel` with no second lookup.
 */

const CACHE_TTL_MS = 30_000

const PackageVersion = Schema.Struct({ version: Schema.optional(Schema.String) })

const refOf = (model: Pick<Model.Info, 'providerID' | 'modelID'>): string =>
  `${model.providerID}/${model.modelID}`

const modelNotFound = (id: string): HarnessError =>
  bridgeError('model_not_found', `unknown model "${id}"`)

const modelInfoOf = (model: Model.Info, defaultId: string | undefined): ModelInfo => {
  const info: Mutable<ModelInfo> = {
    id: refOf(model),
    label: model.name,
    provider: model.providerID,
    contextWindow: model.limit.context,
  }
  if (defaultId === refOf(model)) info.isDefault = true
  return info
}

export class OpenCodeCatalog {
  private modelsCache: { readonly at: number; readonly models: readonly Model.Info[] } | undefined
  private defaultCache: { readonly at: number; readonly model: Model.Info | undefined } | undefined
  private healthCache: { readonly at: number; readonly health: HarnessHealth } | undefined

  private readonly port: OpenCodePort
  constructor(port: OpenCodePort) {
    this.port = port
  }

  listModels = (): Effect.Effect<readonly ModelInfo[], HarnessError> =>
    Effect.flatMap(this.cachedModels(), (models) =>
      Effect.map(this.cachedDefault(), (fallback) => {
        const defaultId = fallback === undefined ? undefined : refOf(fallback)
        return models.map((model) => modelInfoOf(model, defaultId))
      }),
    )

  providers = (): Effect.Effect<readonly ProviderInfo[], HarnessError> =>
    Effect.map(this.port.providers(), (output) =>
      output.data.map((provider) => ({
        id: provider.id,
        label: provider.name === '' ? fallbackProviderLabel(provider.id) : provider.name,
      })),
    )

  /**
   * Resolve a turn's model string to a ref: a `provider/model` string parses
   * directly, a bare id matches the catalogue by model id or name, and
   * anything else fails as not found rather than guessing a provider.
   */
  resolveRef = (id: string): Effect.Effect<Model.Ref, HarnessError> => {
    if (id.includes('/')) {
      try {
        return Effect.succeed(Model.Ref.parse(id))
      } catch {
        return Effect.fail(modelNotFound(id))
      }
    }
    return Effect.flatMap(this.cachedModels(), (models) => {
      const match = models.find(
        (model) => model.modelID === id || model.name === id || refOf(model) === id,
      )
      if (match === undefined) return Effect.fail(modelNotFound(id))
      return Effect.succeed({
        providerID: match.providerID,
        id: match.modelID,
      } satisfies Model.Ref)
    })
  }

  defaultRef = (): Effect.Effect<Model.Ref | undefined, HarnessError> =>
    Effect.map(this.cachedDefault(), (model) =>
      model === undefined
        ? undefined
        : ({ providerID: model.providerID, id: model.modelID } satisfies Model.Ref),
    )

  /** The cached context window for a ref, for the turn's `ContextWindow` fact. */
  contextWindowFor = (ref: Model.Ref): Effect.Effect<number | undefined, HarnessError> =>
    Effect.map(this.cachedModels(), (models) => {
      const match = models.find(
        (model) => model.providerID === ref.providerID && model.modelID === ref.id,
      )
      const window = match?.limit.context
      return window === undefined || window <= 0 ? undefined : window
    })

  /**
   * No binary, port, or socket to probe: health is a catalogue read. Success
   * is ready; anything else is unknown with the reason, never a repair.
   */
  health = (): Effect.Effect<HarnessHealth, HarnessError> => {
    const cached = this.healthCache
    if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
      return Effect.succeed(cached.health)
    }
    return Effect.matchEffect(this.port.models(), {
      onFailure: (cause) =>
        Effect.sync(() => this.memorize({ status: 'unknown', message: cause.message })),
      onSuccess: () => Effect.sync(() => this.memorize({ status: 'ready' })),
    })
  }

  invalidate = (): void => {
    this.modelsCache = undefined
    this.defaultCache = undefined
    this.healthCache = undefined
  }

  private memorize(health: HarnessHealth): HarnessHealth {
    const full = { ...health, ...this.version() }
    this.healthCache = { at: Date.now(), health: full }
    return full
  }

  private cachedModels(): Effect.Effect<readonly Model.Info[], HarnessError> {
    const cached = this.modelsCache
    if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
      return Effect.succeed(cached.models)
    }
    return Effect.map(this.port.models(), (output) => {
      this.modelsCache = { at: Date.now(), models: output.data }
      return output.data
    })
  }

  private cachedDefault(): Effect.Effect<Model.Info | undefined, HarnessError> {
    const cached = this.defaultCache
    if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
      return Effect.succeed(cached.model)
    }
    return Effect.map(this.port.defaultModel(), (model) => {
      this.defaultCache = { at: Date.now(), model }
      return model
    })
  }

  private version() {
    try {
      const require = createRequire(import.meta.url)
      const decoded = Schema.decodeUnknownOption(PackageVersion)(
        require('@opencode/sdk/package.json'),
      )
      if (Option.isSome(decoded) && decoded.value.version !== undefined) {
        return { installedVersion: decoded.value.version }
      }
      return {}
    } catch {
      return {}
    }
  }
}
