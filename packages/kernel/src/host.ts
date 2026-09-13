import {
  Context,
  Effect,
  Exit,
  Option,
  PubSub,
  Queue,
  Ref,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import {
  dataContributionsOf,
  serviceTokensOf,
  type ContributionEntry,
  type ContributionKind,
  type DataContribution,
} from './contribution.ts'
import {
  CoeffectsUnmet,
  DeclarationMismatch,
  ServiceMissing,
  ServiceUndeclared,
  SetupFailed,
  type ActivationError,
  type BootError,
} from './errors.ts'
import { PluginActivated, PluginDeactivated, type HostEvent } from './event.ts'
import type { AnyPlugin, PluginContext } from './plugin.ts'
import { PluginId, PluginScope, TokenId } from './primitives.ts'
import { openRegistry, serviceFacade } from './registry.ts'
import { resolve } from './resolve.ts'
import { serviceId, type AnyServiceToken, type ServiceToken } from './service.ts'
import { openHostFactRecorder, recoverLifecycle } from './host-lifecycle.ts'
import { fromJournal, SessionLog } from './session-log.ts'

export const Activation = Schema.Struct({
  plugin: PluginId,
  scope: PluginScope,
  provides: Schema.Array(TokenId),
})
export type Activation = typeof Activation.Type

export const Graph = Schema.Struct({
  active: Schema.ReadonlyMap(PluginId, Activation),
  blocked: Schema.ReadonlyMap(PluginId, CoeffectsUnmet),
  providers: Schema.ReadonlyMap(TokenId, PluginId),
})
export type Graph = typeof Graph.Type

export interface Host {
  readonly activate: (plugin: AnyPlugin) => Effect.Effect<Activation, ActivationError>
  readonly deactivate: (plugin: PluginId) => Effect.Effect<void>
  readonly replace: (plugin: AnyPlugin) => Effect.Effect<Activation, ActivationError>
  readonly graph: Effect.Effect<Graph>
  readonly events: Stream.Stream<HostEvent>
  readonly contributions: <C>(
    kind: ContributionKind<C>,
  ) => Effect.Effect<readonly ContributionEntry<C>[]>
  readonly service: <S>(token: ServiceToken<S>) => Effect.Effect<S>
  /**
   * A live stand-in for a service token, resolved per call. Setup captures the
   * facade rather than the value, so replacing a provider is seen by everyone
   * that depends on it without re-running their setup.
   */
  readonly facade: <S>(token: ServiceToken<S>) => S
}

interface StoredContribution {
  readonly plugin: PluginId
  readonly value: unknown
}

interface Generation {
  readonly stamp: symbol
}

export const makeHost = Effect.fnUntraced(function* (
  plugins: readonly AnyPlugin[],
): Effect.fn.Return<Host, BootError, Scope.Scope | EventJournal.EventJournal> {
  const hostScope = yield* Scope.Scope
  const pubsub = yield* PubSub.unbounded<HostEvent>()
  const log = fromJournal(yield* EventJournal.EventJournal)
  const known = new Map<PluginId, AnyPlugin>()
  for (const plugin of plugins) {
    if (!known.has(plugin.id)) known.set(plugin.id, plugin)
  }
  const recovered = recoverLifecycle(yield* log.entries.pipe(Effect.orDie), new Set(known.keys()))
  const recorder = yield* openHostFactRecorder(log, recovered.journalActive)
  const recorded = yield* Queue.unbounded<true>()
  const hostEvents = yield* PubSub.subscribe(pubsub)
  yield* Stream.fromSubscription(hostEvents).pipe(
    Stream.runForEach((event) =>
      recorder
        .record(event)
        .pipe(
          Effect.orDie,
          Effect.andThen(
            event._tag === 'ProviderRemoved' ? Effect.void : Queue.offer(recorded, true),
          ),
        ),
    ),
    Effect.forkScoped,
  )
  const emit = (event: HostEvent) =>
    PubSub.publish(pubsub, event).pipe(Effect.andThen(Queue.take(recorded)))
  const registry = yield* openRegistry(pubsub)
  const lock = Semaphore.makeUnsafe(1)
  const active = yield* Ref.make<ReadonlyMap<PluginId, Activation>>(new Map())
  const blocked = yield* Ref.make<ReadonlyMap<PluginId, CoeffectsUnmet>>(new Map())
  const byId = yield* Ref.make<ReadonlyMap<PluginId, AnyPlugin>>(known)
  const desired = yield* Ref.make<ReadonlySet<PluginId>>(recovered.desired)
  const scopes = yield* Ref.make<ReadonlyMap<PluginId, Scope.Closeable>>(new Map())
  const store = yield* Ref.make<ReadonlyMap<string, ReadonlyArray<StoredContribution>>>(new Map())
  const generations = yield* Ref.make<ReadonlyMap<PluginId, Generation>>(new Map())

  const readContributions = <C>(
    kind: ContributionKind<C>,
  ): Effect.Effect<readonly ContributionEntry<C>[]> =>
    Ref.get(store).pipe(
      Effect.map((map) =>
        (map.get(kind.id) ?? []).map((entry) => ({
          plugin: entry.plugin,
          // SAFETY: the payload schema is `unknown`; the kind that wrote it owns the type, and
          // readers look up by the same kind id
          value: entry.value as C,
        })),
      ),
    )

  const facade = <S>(token: ServiceToken<S>): S =>
    serviceFacade(() => registry.peek(token), serviceId(token))

  const serviceTokens = (plugin: AnyPlugin): readonly AnyServiceToken[] =>
    serviceTokensOf(plugin.provides)
  const dataContributions = (plugin: AnyPlugin) => dataContributionsOf(plugin.provides)

  const remember = Effect.fnUntraced(function* (plugin: AnyPlugin) {
    yield* Ref.update(byId, (map) => {
      if (map.has(plugin.id)) return map
      return new Map(map).set(plugin.id, plugin)
    })
    yield* Ref.update(desired, (set) => new Set(set).add(plugin.id))
  })

  const refreshBlocked = Effect.fnUntraced(function* () {
    const liveProviders = yield* registry.providers
    const current = yield* Ref.get(active)
    const want = yield* Ref.get(desired)
    const pluginsById = yield* Ref.get(byId)
    const next = new Map<PluginId, CoeffectsUnmet>()
    for (const id of want) {
      if (current.has(id)) continue
      const plugin = pluginsById.get(id)
      if (plugin === undefined) continue
      const missing = plugin.needs.flatMap((token) => {
        const key = serviceId(token)
        return liveProviders.has(key) ? [] : [key]
      })
      if (missing.length > 0) next.set(id, new CoeffectsUnmet({ plugin: id, missing }))
    }
    yield* Ref.set(blocked, next)
  })

  const requireNeeds = Effect.fnUntraced(function* (plugin: AnyPlugin) {
    const liveProviders = yield* registry.providers
    const missing = plugin.needs.flatMap((token) => {
      const key = serviceId(token)
      return liveProviders.has(key) ? [] : [key]
    })
    if (missing.length > 0) {
      const unmet = new CoeffectsUnmet({ plugin: plugin.id, missing })
      yield* Ref.update(blocked, (map) => new Map(map).set(plugin.id, unmet))
      return yield* Effect.fail(unmet)
    }
  })

  const setupGeneration = Effect.fnUntraced(function* (plugin: AnyPlugin) {
    const pluginScope = yield* Scope.fork(hostScope)
    const contributed: DataContribution[] = []
    const ctx: PluginContext = {
      id: plugin.id,
      scope: plugin.scope,
      contributions: readContributions,
      contribute: (contribution) =>
        Effect.sync(() => {
          contributed.push(contribution)
        }),
    }

    const rawSetup = plugin.server?.setup
    const setup = rawSetup === undefined ? Effect.succeed(Context.empty()) : rawSetup(ctx)
    // SAFETY: missing server facets contribute an empty context; present facets return their provision context
    const base = setup as Effect.Effect<Context.Context<unknown>, unknown, Scope.Scope>
    let wired = base
    for (const token of plugin.needs) {
      wired = Effect.provideService(wired, token, facade(token))
    }
    wired = Effect.provideService(wired, SessionLog, log)
    const provided = yield* Scope.provide(pluginScope)(wired).pipe(
      Effect.mapError((cause) => new SetupFailed({ plugin: plugin.id, cause })),
      Effect.onError(() => Scope.close(pluginScope, Exit.void)),
    )

    // The registry publishes by declaration. A declared service that setup omitted breaks consumers, and a returned service nobody declared is unreachable. It is never published, resolved, or shown in the graph.
    const declared = new Set(serviceTokens(plugin).map(serviceId))
    const problems = [
      ...serviceTokens(plugin).flatMap((token) =>
        Option.isNone(Context.getOption(token)(provided))
          ? [ServiceMissing.make({ token: serviceId(token) })]
          : [],
      ),
      ...[...provided.mapUnsafe.keys()].flatMap((token) =>
        declared.has(token) ? [] : [ServiceUndeclared.make({ token })],
      ),
    ]
    if (problems.length > 0) {
      yield* Scope.close(pluginScope, Exit.void)
      return yield* Effect.fail(new DeclarationMismatch({ plugin: plugin.id, problems }))
    }

    return { pluginScope, provided, contributed }
  })

  const bindReverse = (plugin: AnyPlugin, pluginScope: Scope.Closeable, marker: Generation) =>
    Scope.addFinalizer(
      pluginScope,
      Effect.gen(function* () {
        const live = yield* Ref.get(generations)
        if (live.get(plugin.id) !== marker) return
        for (const token of serviceTokens(plugin)) yield* registry.remove(token, plugin.id)
        yield* Ref.update(store, (map) => {
          const next = new Map(map)
          for (const [kind, list] of next) {
            next.set(
              kind,
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
        yield* Ref.update(generations, (map) => {
          const next = new Map(map)
          next.delete(plugin.id)
          return next
        })
      }),
    )

  const publishServices = Effect.fnUntraced(function* (
    plugin: AnyPlugin,
    provided: Context.Context<unknown>,
  ) {
    for (const token of serviceTokens(plugin)) {
      const value = Option.getOrThrow(Context.getOption(token)(provided))
      yield* registry.provide(token, value, plugin.id)
    }
  })

  const replaceData = Effect.fnUntraced(function* (
    plugin: AnyPlugin,
    contributed: readonly DataContribution[] = [],
  ) {
    yield* Ref.update(store, (map) => {
      const next = new Map(map)
      for (const [kind, list] of next) {
        next.set(
          kind,
          list.filter((entry) => entry.plugin !== plugin.id),
        )
      }
      for (const contribution of [...dataContributions(plugin), ...contributed]) {
        const list = next.get(contribution.kind) ?? []
        next.set(contribution.kind, [...list, { plugin: plugin.id, value: contribution.value }])
      }
      return next
    })
  })

  const recordActivation = Effect.fnUntraced(function* (
    plugin: AnyPlugin,
    pluginScope: Scope.Closeable,
    marker: Generation,
  ) {
    const activation = Activation.make({
      plugin: plugin.id,
      scope: plugin.scope,
      provides: serviceTokens(plugin).map((token) => serviceId(token)),
    })
    yield* Ref.update(generations, (map) => new Map(map).set(plugin.id, marker))
    yield* Ref.update(active, (map) => new Map(map).set(plugin.id, activation))
    yield* Ref.update(byId, (map) => new Map(map).set(plugin.id, plugin))
    yield* Ref.update(scopes, (map) => new Map(map).set(plugin.id, pluginScope))
    yield* Ref.update(blocked, (map) => {
      const next = new Map(map)
      next.delete(plugin.id)
      return next
    })
    return activation
  })

  const install = Effect.fnUntraced(function* (plugin: AnyPlugin) {
    const current = yield* Ref.get(active)
    const existing = current.get(plugin.id)
    if (existing !== undefined) return existing

    yield* requireNeeds(plugin)
    const { pluginScope, provided, contributed } = yield* setupGeneration(plugin)
    const marker: Generation = { stamp: Symbol() }
    yield* bindReverse(plugin, pluginScope, marker)
    yield* publishServices(plugin, provided)
    yield* replaceData(plugin, contributed)
    const activation = yield* recordActivation(plugin, pluginScope, marker)
    yield* emit(PluginActivated.make({ plugin: plugin.id, scope: plugin.scope }))
    return activation
  })

  const cutover = Effect.fnUntraced(function* (plugin: AnyPlugin) {
    yield* requireNeeds(plugin)
    const { pluginScope, provided, contributed } = yield* setupGeneration(plugin)

    const retiring = yield* Ref.get(byId)
    const previous = retiring.get(plugin.id)
    const scopesNow = yield* Ref.get(scopes)
    const oldScope = scopesNow.get(plugin.id)

    const marker: Generation = { stamp: Symbol() }
    yield* bindReverse(plugin, pluginScope, marker)
    const activation = yield* recordActivation(plugin, pluginScope, marker)
    yield* publishServices(plugin, provided)

    const nextKeys = new Set(serviceTokens(plugin).map((token) => serviceId(token)))
    if (previous !== undefined) {
      for (const token of serviceTokens(previous)) {
        if (!nextKeys.has(serviceId(token))) yield* registry.remove(token, plugin.id)
      }
    }
    yield* replaceData(plugin, contributed)

    if (oldScope !== undefined) yield* Scope.close(oldScope, Exit.void)
    return activation
  })

  const reconcile = Effect.fnUntraced(function* () {
    let progressing = true
    while (progressing) {
      progressing = false
      const liveProviders = yield* registry.providers
      const current = yield* Ref.get(active)
      const want = yield* Ref.get(desired)
      const pluginsById = yield* Ref.get(byId)
      for (const id of want) {
        if (current.has(id)) continue
        const plugin = pluginsById.get(id)
        if (plugin === undefined) continue
        if (!plugin.needs.every((token) => liveProviders.has(serviceId(token)))) continue
        const result = yield* Effect.result(install(plugin))
        if (Result.isSuccess(result)) progressing = true
        break
      }
    }
    yield* refreshBlocked()
  })

  const activate = (plugin: AnyPlugin): Effect.Effect<Activation, ActivationError> =>
    lock.withPermit(
      Effect.gen(function* () {
        yield* remember(plugin)
        const result = yield* Effect.result(install(plugin))
        yield* reconcile()
        return yield* Effect.fromResult(result)
      }),
    )

  const deactivateBody = Effect.fnUntraced(function* (id: PluginId): Effect.fn.Return<void> {
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
    for (const dependent of dependents) yield* deactivateBody(dependent)

    const scopesNow = yield* Ref.get(scopes)
    const scope = scopesNow.get(id)
    if (scope === undefined) return
    const plugin = pluginsById.get(id)
    yield* Scope.close(scope, Exit.void)
    if (plugin !== undefined) {
      yield* emit(PluginDeactivated.make({ plugin: id, scope: plugin.scope }))
    }
  })

  const deactivate = (id: PluginId): Effect.Effect<void> =>
    lock.withPermit(
      Effect.gen(function* () {
        yield* Ref.update(desired, (set) => {
          const next = new Set(set)
          next.delete(id)
          return next
        })
        yield* deactivateBody(id)
        yield* reconcile()
      }),
    )

  const replace = (plugin: AnyPlugin): Effect.Effect<Activation, ActivationError> =>
    lock.withPermit(
      Effect.gen(function* () {
        yield* Ref.update(desired, (set) => new Set(set).add(plugin.id))
        const current = yield* Ref.get(active)
        const result = current.has(plugin.id)
          ? yield* Effect.result(cutover(plugin))
          : yield* Effect.result(install(plugin))
        yield* reconcile()
        return yield* Effect.fromResult(result)
      }),
    )

  const graph: Effect.Effect<Graph> = Effect.gen(function* () {
    const a = yield* Ref.get(active)
    const b = yield* Ref.get(blocked)
    const p = yield* registry.providers
    return Graph.make({ active: a, blocked: b, providers: p })
  })

  const plan = yield* Effect.fromResult(resolve(plugins, new Set()))
  for (const plugin of plan.order) {
    const want = yield* Ref.get(desired)
    if (!want.has(plugin.id)) continue
    yield* install(plugin).pipe(Effect.ignore)
  }
  yield* refreshBlocked()

  return {
    activate,
    deactivate,
    replace,
    graph,
    events: Stream.fromPubSub(pubsub),
    contributions: readContributions,
    service: (token) => registry.get(token),
    facade: (token) => serviceFacade(() => registry.peek(token), serviceId(token)),
  }
})
