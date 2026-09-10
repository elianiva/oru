import { Context, Effect, Exit, Option, PubSub, Ref, Schema, Scope, Stream } from "effect"
import { dataContributionsOf, serviceTokensOf, type ContributionKind } from "./contribution.ts"
import {
  CoeffectsUnmet,
  DeclarationMismatch,
  ServiceMissing,
  SetupFailed,
  type ActivationError,
  type BootError,
} from "./errors.ts"
import { PluginActivated, PluginDeactivated, type HostEvent } from "./event.ts"
import type { AnyPlugin, PluginContext } from "./plugin.ts"
import { PluginId, PluginScope, TokenId } from "./primitives.ts"
import { makeFacade, makeRegistry } from "./registry.ts"
import { resolve } from "./resolve.ts"
import { serviceId, type AnyServiceToken } from "./service.ts"

export const Activation = Schema.Struct({
  plugin: PluginId,
  scope: PluginScope,
  provides: Schema.Array(TokenId),
})
export type Activation = Schema.Schema.Type<typeof Activation>

export const Graph = Schema.Struct({
  active: Schema.ReadonlyMap(PluginId, Activation),
  blocked: Schema.ReadonlyMap(PluginId, CoeffectsUnmet),
  providers: Schema.ReadonlyMap(TokenId, PluginId),
})
export type Graph = Schema.Schema.Type<typeof Graph>

export interface ContributionEntry<C> {
  readonly plugin: PluginId
  readonly value: C
}

export interface Host {
  readonly activate: (plugin: AnyPlugin) => Effect.Effect<Activation, ActivationError>
  readonly deactivate: (plugin: PluginId) => Effect.Effect<void>
  readonly graph: Effect.Effect<Graph>
  readonly events: Stream.Stream<HostEvent>
  readonly contributions: <C>(kind: ContributionKind<C>) => Effect.Effect<readonly ContributionEntry<C>[]>
}

interface StoredContribution {
  readonly plugin: PluginId
  readonly value: unknown
}

export const makeHost = (plugins: readonly AnyPlugin[]): Effect.Effect<Host, BootError, Scope.Scope> =>
  Effect.gen(function* () {
    const hostScope = yield* Scope.Scope
    const pubsub = yield* PubSub.unbounded<HostEvent>()
    const registry = yield* makeRegistry(pubsub)
    const active = yield* Ref.make<ReadonlyMap<PluginId, Activation>>(new Map())
    const blocked = yield* Ref.make<ReadonlyMap<PluginId, CoeffectsUnmet>>(new Map())
    const byId = yield* Ref.make<ReadonlyMap<PluginId, AnyPlugin>>(new Map())
    const scopes = yield* Ref.make<ReadonlyMap<PluginId, Scope.Closeable>>(new Map())
    const store = yield* Ref.make<ReadonlyMap<string, ReadonlyArray<StoredContribution>>>(new Map())

    const serviceTokens = (plugin: AnyPlugin): readonly AnyServiceToken[] => serviceTokensOf(plugin.provides)
    const dataContributions = (plugin: AnyPlugin) => dataContributionsOf(plugin.provides)

    function activate(plugin: AnyPlugin): Effect.Effect<Activation, ActivationError> {
      return Effect.gen(function* () {
        const current = yield* Ref.get(active)
        const existing = current.get(plugin.id)
        if (existing !== undefined) return existing

        const liveProviders = yield* registry.providers
        const missing = plugin.needs.map((token) => serviceId(token)).filter((key) => !liveProviders.has(key))
        if (missing.length > 0) {
          const unmet = new CoeffectsUnmet({ plugin: plugin.id, missing })
          yield* Ref.update(blocked, (map) => new Map(map).set(plugin.id, unmet))
          return yield* Effect.fail(unmet)
        }

        const pluginScope = yield* Scope.fork(hostScope)
        const ctx: PluginContext<readonly AnyServiceToken[]> = {
          id: plugin.id,
          scope: plugin.scope,
          service: (token) => makeFacade(registry.get(token)),
        }

        const base = (plugin.server?.setup(ctx) ?? Effect.succeed(Context.empty())) as Effect.Effect<
          Context.Context<unknown>,
          unknown,
          Scope.Scope
        >
        let wired = base
        for (const token of plugin.needs) {
          wired = Effect.provideService(wired, token, makeFacade(registry.get(token)))
        }
        const provided = yield* Scope.provide(pluginScope)(wired).pipe(
          Effect.mapError((cause) => new SetupFailed({ plugin: plugin.id, cause })),
          Effect.onError(() => Scope.close(pluginScope, Exit.void)),
        )

        const problems = serviceTokens(plugin)
          .filter((token) => Option.isNone(Context.getOption(token)(provided)))
          .map((token) => ServiceMissing.make({ token: serviceId(token) }))
        if (problems.length > 0) {
          yield* Scope.close(pluginScope, Exit.void)
          return yield* Effect.fail(new DeclarationMismatch({ plugin: plugin.id, problems }))
        }

        const reverse = Effect.gen(function* () {
          for (const token of serviceTokens(plugin)) yield* registry.remove(token, plugin.id)
          yield* Ref.update(store, (map) => {
            const next = new Map(map)
            for (const contribution of dataContributions(plugin)) {
              const list = next.get(contribution.kind.id) ?? []
              next.set(
                contribution.kind.id,
                list.filter((entry) => entry.plugin !== plugin.id),
              )
            }
            return next
          })
          yield* Ref.update(active, (map) => {
            const next = new Map(map)
            next.delete(plugin.id)
            return next
          })
          yield* Ref.update(scopes, (map) => {
            const next = new Map(map)
            next.delete(plugin.id)
            return next
          })
          yield* PubSub.publish(pubsub, PluginDeactivated.make({ plugin: plugin.id, scope: plugin.scope }))
        })
        yield* Scope.addFinalizer(pluginScope, reverse)

        for (const token of serviceTokens(plugin)) {
          const value = Option.getOrThrow(Context.getOption(token)(provided))
          yield* registry.provide(token, value, plugin.id)
        }
        if (dataContributions(plugin).length > 0) {
          yield* Ref.update(store, (map) => {
            const next = new Map(map)
            for (const contribution of dataContributions(plugin)) {
              const list = next.get(contribution.kind.id) ?? []
              next.set(contribution.kind.id, [...list, { plugin: plugin.id, value: contribution.value }])
            }
            return next
          })
        }

        const activation = Activation.make({
          plugin: plugin.id,
          scope: plugin.scope,
          provides: serviceTokens(plugin).map((token) => serviceId(token)),
        })
        yield* Ref.update(active, (map) => new Map(map).set(plugin.id, activation))
        yield* Ref.update(byId, (map) => new Map(map).set(plugin.id, plugin))
        yield* Ref.update(scopes, (map) => new Map(map).set(plugin.id, pluginScope))
        yield* Ref.update(blocked, (map) => {
          const next = new Map(map)
          next.delete(plugin.id)
          return next
        })
        yield* PubSub.publish(pubsub, PluginActivated.make({ plugin: plugin.id, scope: plugin.scope }))
        return activation
      })
    }

    function deactivate(id: PluginId): Effect.Effect<void> {
      return Effect.gen(function* () {
        const current = yield* Ref.get(active)
        if (!current.has(id)) return
        const pluginsById = yield* Ref.get(byId)
        const liveProviders = yield* registry.providers
        const dependents = [...current.keys()].filter((other) => {
          if (other === id) return false
          const otherPlugin = pluginsById.get(other)
          if (otherPlugin === undefined) return false
          return otherPlugin.needs.some((token) => liveProviders.get(serviceId(token)) === id)
        })
        for (const dependent of dependents) yield* deactivate(dependent)

        const scopesNow = yield* Ref.get(scopes)
        const scope = scopesNow.get(id)
        if (scope === undefined) return
        yield* Scope.close(scope, Exit.void)
      })
    }

    const graph: Effect.Effect<Graph> = Effect.gen(function* () {
      const a = yield* Ref.get(active)
      const b = yield* Ref.get(blocked)
      const p = yield* registry.providers
      return Graph.make({ active: a, blocked: b, providers: p })
    })

    const contributions = <C>(kind: ContributionKind<C>): Effect.Effect<readonly ContributionEntry<C>[]> =>
      Ref.get(store).pipe(
        Effect.map((map) =>
          (map.get(kind.id) ?? []).map((entry) => ({ plugin: entry.plugin, value: entry.value as C })),
        ),
      )

    const plan = yield* Effect.fromResult(resolve(plugins, new Set()))
    yield* Ref.set(blocked, plan.blocked)
    for (const plugin of plan.order) {
      yield* activate(plugin).pipe(Effect.ignore)
    }

    return {
      activate,
      deactivate,
      graph,
      events: Stream.fromPubSub(pubsub),
      contributions,
    }
  })
