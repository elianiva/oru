import type { Effect, Schema, Scope } from 'effect'
import type { ContributionEntry, ContributionKind, DataContribution } from './contribution.ts'
import type { PluginId, PluginScope } from './primitives.ts'
import type { SessionLog } from './session-log.ts'
import type { AnyServiceToken, IdentifierOf, ServiceToken } from './service.ts'

export interface PluginContext {
  readonly id: PluginId
  readonly scope: PluginScope
  readonly contributions: <C>(
    kind: ContributionKind<C>,
  ) => Effect.Effect<readonly ContributionEntry<C>[]>
  readonly contribute: (contribution: DataContribution) => Effect.Effect<void>
  readonly provide: <S>(token: ServiceToken<S>, value: S) => Effect.Effect<void>
  readonly effect: (release: Effect.Effect<void, never, never>) => Effect.Effect<void>
}

export type ApplyEffect<Inject extends readonly AnyServiceToken[], ConfigValue> = Effect.Effect<
  void,
  unknown,
  IdentifierOf<Inject[number]> | Scope.Scope | SessionLog
> & { readonly _config?: ConfigValue }

export type ApplyFn<Inject extends readonly AnyServiceToken[], ConfigValue> = (
  ctx: PluginContext,
  config: ConfigValue,
) => Effect.Effect<void, unknown, IdentifierOf<Inject[number]> | Scope.Scope | SessionLog>

export interface Plugin<
  Inject extends readonly AnyServiceToken[] = readonly AnyServiceToken[],
  ConfigValue = unknown,
> {
  readonly id: PluginId
  readonly scope: PluginScope
  readonly inject: Inject
  readonly panel?: unknown
  readonly Config?: Schema.ConstraintDecoder<ConfigValue>
  readonly apply?: ApplyFn<Inject, NoInfer<ConfigValue>>
}

// oxlint-disable-next-line typescript/no-explicit-any -- mixed plugin graphs erase the config value parameter
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPlugin = Plugin<readonly AnyServiceToken[], any>

export const definePlugin = <
  const Inject extends readonly AnyServiceToken[] = readonly [],
  ConfigValue = unknown,
>(declaration: {
  readonly id: PluginId
  readonly scope?: PluginScope
  readonly inject?: Inject
  readonly panel?: unknown
  readonly Config?: Schema.ConstraintDecoder<ConfigValue>
  readonly apply?: ApplyFn<Inject, NoInfer<ConfigValue>>
}): Plugin<Inject, ConfigValue> => {
  // SAFETY: omitted inject defaults to the empty tuple used by the type parameter
  const inject = (declaration.inject ?? []) as Inject
  const base: Plugin<Inject, ConfigValue> = {
    id: declaration.id,
    scope: declaration.scope ?? 'host',
    inject,
  }
  const withPanel = declaration.panel === undefined ? base : { ...base, panel: declaration.panel }
  if (declaration.Config !== undefined) {
    return declaration.apply === undefined
      ? { ...withPanel, Config: declaration.Config }
      : { ...withPanel, Config: declaration.Config, apply: declaration.apply }
  }
  return declaration.apply === undefined ? withPanel : { ...withPanel, apply: declaration.apply }
}
