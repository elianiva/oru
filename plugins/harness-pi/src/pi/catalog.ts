import { HarnessHealth, ModelInfo, type Mutable, type ProviderInfo } from '@oru/harness'
import { PiRpcChild, piChildEnv, resolvePiLaunch } from './rpc-child.ts'
import { providerInfosOfIds } from './providers.ts'
import { delay, PiBridgeError } from './session.ts'
import { thinkingLevelsOf } from './translate.ts'
import { PiModelsData, PiStateData, type PiModel, type PiStateData as PiState } from './wire.ts'
import {
  healthFromVersion,
  installCommandFor,
  probePiVersion,
  type PiLaunch,
} from './maintenance.ts'

/**
 * pi's catalogue and its health, from one short-lived `pi --mode rpc` probe
 * (ADR-0007).
 *
 * The probe runs with no session and no extension discovery: it answers what
 * models pi can offer and which one it would pick, and nothing it does can
 * touch a thread. The answer is memoized briefly, because the picker asks often
 * and pi's catalogue changes when the user signs in, not between two frames.
 */

const PROBE_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 30_000
const STOP_GRACE_MS = 2_000

/** pi's own words for "there is nothing to talk to". */
const UNAUTHENTICATED_MARKERS: readonly string[] = [
  'No models available',
  'No model selected',
  'No API key found',
]

export interface PiCatalogProbe {
  readonly models: readonly ModelInfo[]
  readonly defaultModelId: string | null
  readonly authenticated: boolean
  /** pi's own words said there was nothing to talk to, so health can say why. */
  readonly unauthenticated: boolean
  readonly state: PiState | null
  readonly failure: string | null
}

export interface PiCatalogDeps {
  readonly env: NodeJS.ProcessEnv
  readonly launch: PiLaunch
  readonly log: (message: string) => void
}

const modelIdOf = (model: PiModel): string => `${model.provider ?? 'unknown'}/${model.id}`

const toModelInfo = (model: PiModel, defaultModelId: string | null): ModelInfo => {
  const id = modelIdOf(model)
  const info: Mutable<ModelInfo> = {
    id,
    label: model.name ?? model.id,
    provider: model.provider ?? 'unknown',
    reasoning: model.reasoning === true,
    reasoningLevels: thinkingLevelsOf(model),
    isDefault: id === defaultModelId,
  }
  // Absent is not the same as undefined: a model without a declared window
  // leaves the field off rather than claiming zero tokens.
  if (model.contextWindow !== undefined) info.contextWindow = model.contextWindow
  return info
}

export class PiCatalog {
  private cached: { readonly at: number; readonly value: PiCatalogProbe } | null = null
  private inflight: Promise<PiCatalogProbe> | null = null
  private version: { readonly at: number; readonly raw: string | undefined } | null = null
  private probeEpoch = 0
  private threadDefault: string | null = null
  private readonly deps: PiCatalogDeps

  constructor(deps: PiCatalogDeps) {
    this.deps = deps
  }

  /** pi reported the default it resolved for a thread; prefer it for the marker. */
  observeThreadDefault(modelId: string | null): void {
    if (modelId !== null) this.threadDefault = modelId
  }

  async models(): Promise<readonly ModelInfo[]> {
    const probe = await this.probe()
    const preferred = this.threadDefault ?? probe.defaultModelId
    return probe.models.map((model) =>
      model.isDefault === true && model.id !== preferred ? { ...model, isDefault: false } : model,
    )
  }

  /** The providers behind the catalogue, curated for the picker's tabs. */
  async providers(): Promise<readonly ProviderInfo[]> {
    const probe = await this.probe()
    return providerInfosOfIds(probe.models.map((model) => model.provider ?? 'unknown'))
  }

  async health(): Promise<HarnessHealth> {
    const installCommand = installCommandFor(this.deps.launch.command)
    const version = await this.installedVersion()
    const base = healthFromVersion(version, installCommand)
    if (base.status !== 'ready') return base
    const probe = await this.probe()
    if (probe.authenticated) return base
    const health: Mutable<HarnessHealth> = {
      status: probe.unauthenticated ? 'unauthenticated' : 'unknown',
      message:
        probe.failure ?? 'pi has no model available; sign in with `pi` before oru can run a turn',
      installCommand,
    }
    if (version !== undefined) health.installedVersion = version
    if (base.minimumSupportedVersion !== undefined) {
      health.minimumSupportedVersion = base.minimumSupportedVersion
    }
    return HarnessHealth.make(health)
  }

  invalidate(): void {
    this.probeEpoch += 1
    this.cached = null
    this.version = null
    this.inflight = null
  }

  private async installedVersion(): Promise<string | undefined> {
    const now = Date.now()
    if (this.version !== null && now - this.version.at < CACHE_TTL_MS) return this.version.raw
    const epoch = this.probeEpoch
    const raw = probePiVersion(this.deps.launch, this.deps.env)
    if (epoch === this.probeEpoch) this.version = { at: now, raw }
    return raw
  }

  private probe(): Promise<PiCatalogProbe> {
    const now = Date.now()
    if (this.cached !== null && now - this.cached.at < CACHE_TTL_MS) {
      return Promise.resolve(this.cached.value)
    }
    const epoch = this.probeEpoch
    this.inflight ??= this.runProbe()
      .then((value) => {
        if (epoch === this.probeEpoch) this.cached = { at: Date.now(), value }
        return value
      })
      .finally(() => {
        this.inflight = null
      })
    return this.inflight
  }

  private async runProbe(): Promise<PiCatalogProbe> {
    const child = new PiRpcChild({
      cwd: process.cwd(),
      env: piChildEnv(this.deps.env, {}),
      launch: resolvePiLaunch(this.deps.env),
      args: ['--mode', 'rpc', '--no-session', '--no-extensions'],
      onEvent: () => undefined,
      onChannelMessage: () => undefined,
      onExit: () => undefined,
    })
    try {
      const state = await child.requestOk(PiStateData, { type: 'get_state' }, PROBE_TIMEOUT_MS)
      const listResult = await child
        .requestOk(PiModelsData, { type: 'get_available_models' }, PROBE_TIMEOUT_MS)
        .then((data) => ({ ok: true as const, data }))
        .catch((cause: unknown) => ({
          ok: false as const,
          message: cause instanceof Error ? cause.message : String(cause),
        }))
      if (!listResult.ok) {
        return {
          models: [],
          defaultModelId: null,
          authenticated: state.model !== null,
          unauthenticated: false,
          state,
          failure: listResult.message,
        }
      }
      const defaultModelId = state.model === null ? null : modelIdOf(state.model)
      return {
        models: listResult.data.models.map((model) => toModelInfo(model, defaultModelId)),
        defaultModelId,
        authenticated: state.model !== null,
        unauthenticated: false,
        state,
        failure: null,
      }
    } catch (cause) {
      const probeFailure =
        cause instanceof PiBridgeError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : String(cause)
      const stderr = child.stderr
      const unauthenticated = UNAUTHENTICATED_MARKERS.some(
        (marker) => stderr.includes(marker) || probeFailure.includes(marker),
      )
      return {
        models: [],
        defaultModelId: null,
        authenticated: false,
        unauthenticated,
        state: null,
        failure: stderr.trim() === '' ? probeFailure : stderr.trim(),
      }
    } finally {
      child.closeGracefully()
      await Promise.race([child.waitForExit(), delay(STOP_GRACE_MS)])
    }
  }
}
