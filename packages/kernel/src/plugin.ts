import type { Context, Effect, Scope } from 'effect'
import type { Contribution, ServiceProvisions } from './contribution.ts'
import type { PluginId, PluginScope } from './primitives.ts'
import type { AnyServiceToken, ServiceOf } from './service.ts'

export interface PluginContext<Needs extends readonly AnyServiceToken[]> {
  readonly id: PluginId
  readonly scope: PluginScope
  readonly service: <T extends Needs[number]>(token: T) => ServiceOf<T>
}

export interface ServerFacet<
  Needs extends readonly AnyServiceToken[],
  Provides extends readonly Contribution[],
> {
  readonly setup: (
    ctx: PluginContext<Needs>,
  ) => Effect.Effect<
    Context.Context<ServiceProvisions<Provides>>,
    unknown,
    ServiceOf<Needs[number]> | Scope.Scope
  >
}

export interface Plugin<
  Needs extends readonly AnyServiceToken[] = readonly AnyServiceToken[],
  Provides extends readonly Contribution[] = readonly Contribution[],
  UI = unknown,
> {
  readonly id: PluginId
  readonly scope: PluginScope
  readonly needs: Needs
  readonly provides: Provides
  readonly server?: ServerFacet<Needs, Provides>
  readonly ui?: UI
}

export type AnyPlugin = Plugin<readonly AnyServiceToken[], readonly Contribution[], unknown>

export const definePlugin = <
  const Needs extends readonly AnyServiceToken[] = readonly [],
  const Provides extends readonly Contribution[] = readonly [],
  UI = never,
>(declaration: {
  readonly id: PluginId
  readonly scope?: PluginScope
  readonly needs?: Needs
  readonly provides?: Provides
  readonly server?: ServerFacet<Needs, Provides>
  readonly ui?: UI
}): Plugin<Needs, Provides, UI> => {
  // SAFETY: omitted needs default to the empty tuple used by the type parameter
  const needs = (declaration.needs ?? []) as Needs
  // SAFETY: omitted provides default to the empty tuple used by the type parameter
  const provides = (declaration.provides ?? []) as Provides
  if (declaration.server !== undefined && declaration.ui !== undefined) {
    return {
      id: declaration.id,
      scope: declaration.scope ?? 'host',
      needs,
      provides,
      server: declaration.server,
      ui: declaration.ui,
    }
  }
  if (declaration.server !== undefined) {
    return {
      id: declaration.id,
      scope: declaration.scope ?? 'host',
      needs,
      provides,
      server: declaration.server,
    }
  }
  if (declaration.ui !== undefined) {
    return {
      id: declaration.id,
      scope: declaration.scope ?? 'host',
      needs,
      provides,
      ui: declaration.ui,
    }
  }
  return {
    id: declaration.id,
    scope: declaration.scope ?? 'host',
    needs,
    provides,
  }
}
