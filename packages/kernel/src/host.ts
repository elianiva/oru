import {
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
import {
  type ContributionEntry,
  type ContributionKind,
  type DataContribution,
} from './contribution.ts'
import { BootKind } from './boot.ts'
import {
  CoeffectsUnmet,
  DuplicateProvider,
  SetupFailed,
  type ActivationError,
  type BootError,
} from './errors.ts'
import { PluginActivated, PluginDeactivated, ProviderRemoved, type HostEvent } from './event.ts'
import type { AnyPlugin, PluginContext } from './plugin.ts'
import { BundleAddress, PluginId, PluginScope, ThreadId, TokenId } from './primitives.ts'
import { openRegistry, serviceFacade, type Registry } from './registry.ts'
import { resolve } from './resolve.ts'
import { serviceId, type AnyServiceToken, type ServiceToken } from './service.ts'
import { openHostFactRecorder, recoverLifecycle } from './host-lifecycle.ts'
import { SessionLog } from './session-log.ts'

export const Activation = Schema.Struct({
  plugin: PluginId,
  scope: PluginScope,
  provides: Schema.Array(TokenId),
  generation: Schema.optionalKey(BundleAddress),
})
export type Activation = typeof Activation.Type

export const Graph = Schema.Struct({
  active: Schema.ReadonlyMap(PluginId, Activation),
  blocked: Schema.ReadonlyMap(PluginId, CoeffectsUnmet),
  providers: Schema.ReadonlyMap(TokenId, PluginId),
})
export type Graph = typeof Graph.Type

export interface Host {
  readonly activate: (
    plugin: AnyPlugin,
    thread?: ThreadId,
  ) => Effect.Effect<Activation, ActivationError>
  readonly deactivate: (plugin: PluginId) => Effect.Effect<void>
  readonly replace: (
    plugin: AnyPlugin,
    generation?: BundleAddress,
  ) => Effect.Effect<Activation, ActivationError>
  readonly openThread: (thread: ThreadId) => Effect.Effect<void, ActivationError>
  readonly closeThread: (thread: ThreadId) => Effect.Effect<void>
  readonly graph: Effect.Effect<Graph>
  readonly graphFor: (thread: ThreadId) => Effect.Effect<Graph>
  readonly events: Stream.Stream<HostEvent>
  readonly contributions: <C>(
    kind: ContributionKind<C>,
    thread?: ThreadId,
  ) => Effect.Effect<readonly ContributionEntry<C>[]>
  readonly service: <S>(token: ServiceToken<S>, thread?: ThreadId) => Effect.Effect<S>
  readonly facade: <S>(token: ServiceToken<S>, thread?: ThreadId) => S
}

interface StoredContribution {
  readonly plugin: PluginId
  readonly thread: ThreadId | undefined
  readonly value: unknown
}

interface ProvidedService {
  readonly token: AnyServiceToken
  readonly value: unknown
}

const layerKey = (plugin: PluginId, thread?: ThreadId): string =>
  thread === undefined ? `\0${plugin}` : `${thread}\0${plugin}`

interface Generation {
  readonly address: BundleAddress | undefined
}

/** Config data decoded against a plugin's own `Config`, carried as data to its `apply`. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: values arrive parsed by each def's own Config schema in decodeConfig; the host only carries them
type DecodedConfig = Record<string, unknown> | undefined

export const makeHost = Effect.fnUntraced(function* (
  plugins: readonly AnyPlugin[],
  configs?: ReadonlyMap<PluginId, unknown>,
): Effect.fn.Return<Host, BootError, Scope.Scope | SessionLog> {
  const hostScope = yield* Scope.Scope
  const pubsub = yield* PubSub.unbounded<HostEvent>()
  const log = yield* SessionLog
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
            Schema.is(ProviderRemoved)(event) ? Effect.void : Queue.offer(recorded, true),
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
  const scopes = yield* Ref.make<ReadonlyMap<string, Scope.Closeable>>(new Map())
  const store = yield* Ref.make<ReadonlyMap<string, ReadonlyArray<StoredContribution>>>(new Map())
  const generations = yield* Ref.make<ReadonlyMap<string, Generation>>(new Map())
  const providedTokens = yield* Ref.make<ReadonlyMap<string, readonly AnyServiceToken[]>>(new Map())
  const booted = yield* Ref.make<ReadonlySet<PluginId>>(new Set())
  const threadRoots = yield* Ref.make<ReadonlyMap<ThreadId, Scope.Closeable>>(new Map())
  const threadRegistries = yield* Ref.make<ReadonlyMap<ThreadId, Registry>>(new Map())
  const threadActive = yield* Ref.make<ReadonlyMap<ThreadId, ReadonlyMap<PluginId, Activation>>>(
    new Map(),
  )
  const threadDesired = yield* Ref.make<ReadonlyMap<ThreadId, ReadonlySet<PluginId>>>(new Map())

  const runBootSteps = Effect.fnUntraced(function* () {
    const done = yield* Ref.get(booted)
    for (const step of yield* readContributions(BootKind)) {
      if (done.has(step.plugin)) continue
      yield* Ref.update(booted, (set) => new Set(set).add(step.plugin))
      yield* step.value
    }
  })

  const visibleIn = (entry: StoredContribution, thread?: ThreadId): boolean =>
    entry.thread === undefined || entry.thread === thread

  const readContributions = <C>(
    kind: ContributionKind<C>,
    thread?: ThreadId,
  ): Effect.Effect<readonly ContributionEntry<C>[]> =>
    Ref.get(store).pipe(
      Effect.map((map) =>
        (map.get(kind.id) ?? [])
          .filter((entry) => visibleIn(entry, thread))
          .map((entry) => ({
            plugin: entry.plugin,
            // SAFETY: the payload schema is `unknown`; the kind that wrote it owns the type,
            // and readers look up by the same kind id
            value: entry.value as C,
          })),
      ),
    )

  const registryOf = (thread?: ThreadId): Registry => {
    if (thread === undefined) return registry
    return Ref.getUnsafe(threadRegistries).get(thread) ?? registry
  }

  const peekService = <S>(token: ServiceToken<S>, thread?: ThreadId): S | undefined => {
    if (thread !== undefined) {
      const lane = Ref.getUnsafe(threadRegistries).get(thread)?.peek(token)
      if (lane !== undefined) return lane
    }
    return registry.peek(token)
  }

  const facade = <S>(token: ServiceToken<S>, thread?: ThreadId): S =>
    serviceFacade(() => peekService(token, thread), serviceId(token))

  const remember = Effect.fnUntraced(function* (plugin: AnyPlugin) {
    yield* Ref.update(byId, (map) => {
      if (map.has(plugin.id)) return map
      return new Map(map).set(plugin.id, plugin)
    })
    if (plugin.scope === 'host') {
      yield* Ref.update(desired, (set) => new Set(set).add(plugin.id))
    }
  })

  const mergedProviders = Effect.fnUntraced(function* (thread?: ThreadId) {
    const hostProviders = yield* registry.providers
    if (thread === undefined) return hostProviders
    const lane = Ref.getUnsafe(threadRegistries).get(thread)
    if (lane === undefined) return hostProviders
    const next = new Map(hostProviders)
    for (const [token, owner] of yield* lane.providers) next.set(token, owner)
    return next
  })

  const missingInject = (plugin: AnyPlugin, liveProviders: ReadonlyMap<string, PluginId>) =>
    plugin.inject.flatMap((token) => {
      const key = serviceId(token)
      return liveProviders.has(key) ? [] : [key]
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
      if (plugin === undefined || plugin.scope === 'thread') continue
      const missing = missingInject(plugin, liveProviders)
      if (missing.length > 0) next.set(id, new CoeffectsUnmet({ plugin: id, missing }))
    }
    yield* Ref.set(blocked, next)
  })

  const requireInject = Effect.fnUntraced(function* (plugin: AnyPlugin, thread?: ThreadId) {
    const liveProviders = yield* mergedProviders(thread)
    const missing = missingInject(plugin, liveProviders)
    if (missing.length > 0) {
      const unmet = new CoeffectsUnmet({ plugin: plugin.id, missing })
      if (thread === undefined) {
        yield* Ref.update(blocked, (map) => new Map(map).set(plugin.id, unmet))
      }
      return yield* Effect.fail(unmet)
    }
  })

  const decodeConfig = (plugin: AnyPlugin): Effect.Effect<DecodedConfig, SetupFailed> =>
    Effect.gen(function* () {
      if (plugin.Config === undefined) return undefined
      const raw = configs?.get(plugin.id) ?? {}
      const decoded = Schema.decodeUnknownOption(plugin.Config)(raw)
      if (Option.isNone(decoded)) {
        return yield* Effect.fail(
          new SetupFailed({ plugin: plugin.id, cause: `invalid config for ${plugin.id}` }),
        )
      }
      // SAFETY: every Config in this repo decodes to a string-keyed object; the host
      // only carries it as data to the def that declared the schema
      return decoded.value as DecodedConfig
    })

  const setupGeneration = Effect.fnUntraced(function* (plugin: AnyPlugin, thread?: ThreadId) {
    const parent =
      thread === undefined ? hostScope : ((yield* Ref.get(threadRoots)).get(thread) ?? hostScope)
    const pluginScope = yield* Scope.fork(parent)
    const contributed: DataContribution[] = []
    const provided: ProvidedService[] = []
    const ctx: PluginContext = {
      id: plugin.id,
      scope: plugin.scope,
      contributions: (kind) => readContributions(kind, thread),
      contribute: (contribution) =>
        Effect.sync(() => {
          contributed.push(contribution)
        }),
      provide: (token, value) =>
        Effect.sync(() => {
          // SAFETY: a ServiceToken<S> is an AnyServiceToken with its instance forgotten;
          // the lane re-keys it by token id and hands the value back under the same token
          provided.push({ token: token as AnyServiceToken, value })
        }),
      effect: (release) => Scope.addFinalizer(pluginScope, release),
    }

    const config = yield* decodeConfig(plugin)
    // SAFETY: AnyPlugin erases inject and config params; the host decoded this def's
    // Config above and provides inject facades plus SessionLog below
    const apply = plugin.apply as
      | undefined
      | ((ctx: PluginContext, config: DecodedConfig) => Effect.Effect<void, unknown, Scope.Scope>)
    let wired: Effect.Effect<void, unknown, Scope.Scope> =
      apply === undefined ? Effect.void : apply(ctx, config)
    for (const token of plugin.inject) {
      wired = Effect.provideService(wired, token, facade(token, thread))
    }
    // SAFETY: SessionLog is ambient in every apply; providing it here leaves inject and Scope
    wired = Effect.provideService(wired, SessionLog, log) as typeof wired
    yield* Scope.provide(pluginScope)(wired).pipe(
      Effect.mapError((cause) => new SetupFailed({ plugin: plugin.id, cause })),
      Effect.onError(() => Scope.close(pluginScope, Exit.void)),
    )
    return { pluginScope, provided, contributed }
  })

  const bindReverse = (
    plugin: AnyPlugin,
    pluginScope: Scope.Closeable,
    marker: Generation,
    tokens: readonly AnyServiceToken[],
    thread?: ThreadId,
  ) =>
    Scope.addFinalizer(
      pluginScope,
      Effect.gen(function* () {
        const key = layerKey(plugin.id, thread)
        const live = yield* Ref.get(generations)
        if (live.get(key) !== marker) return
        const lane = registryOf(thread)
        for (const token of tokens) yield* lane.remove(token, plugin.id)
        yield* Ref.update(store, (map) => {
          const next = new Map(map)
          for (const [kind, list] of next) {
            next.set(
              kind,
              list.filter((entry) => !(entry.plugin === plugin.id && entry.thread === thread)),
            )
          }
          return next
        })
        if (thread === undefined) {
          yield* Ref.update(active, (map) => {
            const next = new Map(map)
            next.delete(plugin.id)
            return next
          })
        } else {
          yield* Ref.update(threadActive, (map) => {
            const laneActive = map.get(thread)
            if (laneActive === undefined) return map
            const nextLane = new Map(laneActive)
            nextLane.delete(plugin.id)
            return new Map(map).set(thread, nextLane)
          })
        }
        yield* Ref.update(scopes, (map) => {
          const next = new Map(map)
          next.delete(key)
          return next
        })
        yield* Ref.update(generations, (map) => {
          const next = new Map(map)
          next.delete(key)
          return next
        })
        yield* Ref.update(providedTokens, (map) => {
          const next = new Map(map)
          next.delete(key)
          return next
        })
      }),
    )

  const publishServices = Effect.fnUntraced(function* (
    plugin: AnyPlugin,
    provided: readonly ProvidedService[],
    thread?: ThreadId,
  ) {
    const liveProviders = yield* mergedProviders(thread)
    for (const { token } of provided) {
      const owner = liveProviders.get(serviceId(token))
      if (owner !== undefined && owner !== plugin.id) {
        return yield* Effect.fail(
          new DuplicateProvider({ token: serviceId(token), existing: owner, incoming: plugin.id }),
        )
      }
    }
    const lane = registryOf(thread)
    for (const { token, value } of provided) {
      // SAFETY: the lane keys by token id and hands the value back under the same token;
      // the host collected both halves from one ctx.provide call
      yield* lane.provide(token as never, value as never, plugin.id)
    }
  })

  const replaceData = Effect.fnUntraced(function* (
    plugin: AnyPlugin,
    contributed: readonly DataContribution[] = [],
    thread?: ThreadId,
  ) {
    yield* Ref.update(store, (map) => {
      const next = new Map(map)
      for (const [kind, list] of next) {
        next.set(
          kind,
          list.filter((entry) => !(entry.plugin === plugin.id && entry.thread === thread)),
        )
      }
      for (const contribution of contributed) {
        const list = next.get(contribution.kind) ?? []
        next.set(contribution.kind, [
          ...list,
          { plugin: plugin.id, thread, value: contribution.value },
        ])
      }
      return next
    })
  })

  const recordActivation = Effect.fnUntraced(function* (
    plugin: AnyPlugin,
    pluginScope: Scope.Closeable,
    marker: Generation,
    tokens: readonly AnyServiceToken[],
    thread?: ThreadId,
  ) {
    const provides = tokens.map((token) => serviceId(token))
    const activation =
      marker.address === undefined
        ? Activation.make({ plugin: plugin.id, scope: plugin.scope, provides })
        : Activation.make({
            plugin: plugin.id,
            scope: plugin.scope,
            provides,
            generation: marker.address,
          })
    const key = layerKey(plugin.id, thread)
    yield* Ref.update(generations, (map) => new Map(map).set(key, marker))
    yield* Ref.update(providedTokens, (map) => new Map(map).set(key, tokens))
    if (thread === undefined) {
      yield* Ref.update(active, (map) => new Map(map).set(plugin.id, activation))
    } else {
      yield* Ref.update(threadActive, (map) => {
        const lane = new Map(map.get(thread) ?? [])
        lane.set(plugin.id, activation)
        return new Map(map).set(thread, lane)
      })
    }
    yield* Ref.update(byId, (map) => new Map(map).set(plugin.id, plugin))
    yield* Ref.update(scopes, (map) => new Map(map).set(key, pluginScope))
    if (thread === undefined) {
      yield* Ref.update(blocked, (map) => {
        const next = new Map(map)
        next.delete(plugin.id)
        return next
      })
    }
    yield* Ref.update(booted, (set) => {
      const next = new Set(set)
      next.delete(plugin.id)
      return next
    })
    return activation
  })

  const install = Effect.fnUntraced(function* (
    plugin: AnyPlugin,
    thread?: ThreadId,
    address?: BundleAddress,
  ) {
    if (plugin.scope === 'thread' && thread === undefined) {
      return Activation.make({ plugin: plugin.id, scope: plugin.scope, provides: [] })
    }
    const current =
      thread === undefined
        ? yield* Ref.get(active)
        : ((yield* Ref.get(threadActive)).get(thread) ?? new Map())
    const existing = current.get(plugin.id)
    if (existing !== undefined) return existing

    yield* requireInject(plugin, thread)
    const { pluginScope, provided, contributed } = yield* setupGeneration(plugin, thread)
    const tokens = provided.map((entry) => entry.token)
    const marker: Generation = { address }
    yield* bindReverse(plugin, pluginScope, marker, tokens, thread)
    yield* publishServices(plugin, provided, thread).pipe(
      Effect.onError(() => Scope.close(pluginScope, Exit.void)),
    )
    yield* replaceData(plugin, contributed, thread)
    const activation = yield* recordActivation(plugin, pluginScope, marker, tokens, thread)
    yield* emit(PluginActivated.make({ plugin: plugin.id, scope: plugin.scope }))
    return activation
  })

  const cutover = Effect.fnUntraced(function* (
    plugin: AnyPlugin,
    thread?: ThreadId,
    address?: BundleAddress,
  ) {
    yield* requireInject(plugin, thread)
    const { pluginScope, provided, contributed } = yield* setupGeneration(plugin, thread)
    const tokens = provided.map((entry) => entry.token)

    const scopesNow = yield* Ref.get(scopes)
    const oldScope = scopesNow.get(layerKey(plugin.id, thread))

    const marker: Generation = { address }
    yield* bindReverse(plugin, pluginScope, marker, tokens, thread)
    const activation = yield* recordActivation(plugin, pluginScope, marker, tokens, thread)
    yield* publishServices(plugin, provided, thread).pipe(
      Effect.onError(() => Scope.close(pluginScope, Exit.void)),
    )

    const nextKeys = new Set(tokens.map((token) => serviceId(token)))
    const oldTokens = (yield* Ref.get(providedTokens)).get(layerKey(plugin.id, thread)) ?? []
    const lane = registryOf(thread)
    for (const token of oldTokens) {
      if (!nextKeys.has(serviceId(token))) yield* lane.remove(token, plugin.id)
    }
    yield* replaceData(plugin, contributed, thread)

    if (oldScope !== undefined) yield* Scope.close(oldScope, Exit.void)
    return activation
  })

  const reconcile = Effect.fnUntraced(function* (thread?: ThreadId) {
    let progressing = true
    while (progressing) {
      progressing = false
      const liveProviders = yield* mergedProviders(thread)
      const current =
        thread === undefined
          ? yield* Ref.get(active)
          : ((yield* Ref.get(threadActive)).get(thread) ?? new Map())
      const want =
        thread === undefined
          ? yield* Ref.get(desired)
          : ((yield* Ref.get(threadDesired)).get(thread) ?? new Set())
      const pluginsById = yield* Ref.get(byId)
      for (const id of want) {
        if (current.has(id)) continue
        const plugin = pluginsById.get(id)
        if (plugin === undefined) continue
        if (thread === undefined ? plugin.scope === 'thread' : plugin.scope !== 'thread') continue
        if (!plugin.inject.every((token) => liveProviders.has(serviceId(token)))) continue
        const result = yield* Effect.result(install(plugin, thread))
        if (Result.isSuccess(result)) progressing = true
        break
      }
    }
    if (thread === undefined) yield* refreshBlocked()
  })

  const openThreadBody = Effect.fnUntraced(function* (thread: ThreadId) {
    const roots = yield* Ref.get(threadRoots)
    if (roots.has(thread)) return
    const threadScope = yield* Scope.fork(hostScope)
    const threadRegistry = yield* openRegistry(pubsub)
    yield* Ref.update(threadRoots, (map) => new Map(map).set(thread, threadScope))
    yield* Ref.update(threadRegistries, (map) => new Map(map).set(thread, threadRegistry))
    yield* Ref.update(threadActive, (map) => new Map(map).set(thread, new Map()))
    yield* Ref.update(threadDesired, (map) =>
      map.has(thread) ? map : new Map(map).set(thread, new Set()),
    )
    yield* reconcile(thread)
    yield* runBootSteps()
  })

  const closeThreadBody = Effect.fnUntraced(function* (thread: ThreadId) {
    const roots = yield* Ref.get(threadRoots)
    const root = roots.get(thread)
    if (root === undefined) return
    const lane = (yield* Ref.get(threadActive)).get(thread)
    const ids = [...(lane?.keys() ?? [])]
    const pluginsById = yield* Ref.get(byId)
    yield* Scope.close(root, Exit.void)
    yield* Ref.update(threadRoots, (map) => {
      const next = new Map(map)
      next.delete(thread)
      return next
    })
    yield* Ref.update(threadRegistries, (map) => {
      const next = new Map(map)
      next.delete(thread)
      return next
    })
    yield* Ref.update(threadActive, (map) => {
      const next = new Map(map)
      next.delete(thread)
      return next
    })
    yield* Ref.update(threadDesired, (map) => {
      const next = new Map(map)
      next.delete(thread)
      return next
    })
    for (const id of ids) {
      const plugin = pluginsById.get(id)
      if (plugin !== undefined) {
        yield* emit(PluginDeactivated.make({ plugin: id, scope: plugin.scope }))
      }
    }
  })

  const activate = (
    plugin: AnyPlugin,
    thread?: ThreadId,
  ): Effect.Effect<Activation, ActivationError> =>
    lock.withPermit(
      Effect.gen(function* () {
        yield* remember(plugin)
        if (plugin.scope === 'thread') {
          if (thread === undefined) {
            return Activation.make({ plugin: plugin.id, scope: plugin.scope, provides: [] })
          }
          yield* Ref.update(threadDesired, (map) => {
            const next = new Set(map.get(thread) ?? [])
            next.add(plugin.id)
            return new Map(map).set(thread, next)
          })
          const result = yield* Effect.result(install(plugin, thread))
          yield* reconcile(thread)
          yield* runBootSteps()
          return yield* Effect.fromResult(result)
        }
        const result = yield* Effect.result(install(plugin))
        yield* reconcile()
        yield* runBootSteps()
        return yield* Effect.fromResult(result)
      }),
    )

  const deactivateBody = Effect.fnUntraced(function* (id: PluginId): Effect.fn.Return<void> {
    const pluginsById = yield* Ref.get(byId)
    const plugin = pluginsById.get(id)
    if (plugin?.scope === 'thread') {
      for (const thread of (yield* Ref.get(threadRoots)).keys()) {
        const scope = (yield* Ref.get(scopes)).get(layerKey(id, thread))
        if (scope === undefined) continue
        yield* Scope.close(scope, Exit.void)
        yield* emit(PluginDeactivated.make({ plugin: id, scope: plugin.scope }))
      }
      return
    }
    const current = yield* Ref.get(active)
    if (!current.has(id)) return
    const liveProviders = yield* registry.providers
    const dependents = [...current.keys()].filter((other) => {
      if (other === id) return false
      const otherPlugin = pluginsById.get(other)
      if (otherPlugin === undefined) return false
      return otherPlugin.inject.some((token) => liveProviders.get(serviceId(token)) === id)
    })
    for (const dependent of dependents) yield* deactivateBody(dependent)

    const scopesNow = yield* Ref.get(scopes)
    const scope = scopesNow.get(layerKey(id))
    if (scope === undefined) return
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
        yield* Ref.update(threadDesired, (map) => {
          const next = new Map(map)
          for (const [thread, ids] of next) {
            if (!ids.has(id)) continue
            const copy = new Set(ids)
            copy.delete(id)
            next.set(thread, copy)
          }
          return next
        })
        yield* deactivateBody(id)
        yield* reconcile()
      }),
    )

  const replace = (
    plugin: AnyPlugin,
    generation?: BundleAddress,
  ): Effect.Effect<Activation, ActivationError> =>
    lock.withPermit(
      Effect.gen(function* () {
        yield* Ref.update(desired, (set) =>
          plugin.scope === 'host' ? new Set(set).add(plugin.id) : set,
        )
        if (plugin.scope === 'thread') {
          let last = Activation.make({ plugin: plugin.id, scope: plugin.scope, provides: [] })
          for (const thread of (yield* Ref.get(threadRoots)).keys()) {
            const lane = (yield* Ref.get(threadActive)).get(thread)
            if (lane === undefined || !lane.has(plugin.id)) continue
            const result = yield* Effect.result(cutover(plugin, thread, generation))
            if (Result.isSuccess(result)) last = result.success
            else return yield* Effect.fromResult(result)
          }
          yield* reconcile()
          yield* runBootSteps()
          return last
        }
        const current = yield* Ref.get(active)
        const result = current.has(plugin.id)
          ? yield* Effect.result(cutover(plugin, undefined, generation))
          : yield* Effect.result(install(plugin, undefined, generation))
        yield* reconcile()
        yield* runBootSteps()
        return yield* Effect.fromResult(result)
      }),
    )

  const graph: Effect.Effect<Graph> = Effect.gen(function* () {
    const a = yield* Ref.get(active)
    const b = yield* Ref.get(blocked)
    const p = yield* registry.providers
    return Graph.make({ active: a, blocked: b, providers: p })
  })

  const graphFor = (thread: ThreadId): Effect.Effect<Graph> =>
    Effect.gen(function* () {
      const hostActive = yield* Ref.get(active)
      const lane = (yield* Ref.get(threadActive)).get(thread) ?? new Map()
      const merged = new Map(hostActive)
      for (const [id, activation] of lane) merged.set(id, activation)
      const providers = yield* mergedProviders(thread)
      const want = (yield* Ref.get(threadDesired)).get(thread) ?? new Set()
      const pluginsById = yield* Ref.get(byId)
      const nextBlocked = new Map<PluginId, CoeffectsUnmet>()
      for (const id of want) {
        if (merged.has(id)) continue
        const plugin = pluginsById.get(id)
        if (plugin === undefined) continue
        const missing = missingInject(plugin, providers)
        if (missing.length > 0) nextBlocked.set(id, new CoeffectsUnmet({ plugin: id, missing }))
      }
      return Graph.make({ active: merged, blocked: nextBlocked, providers })
    })

  const openThread = (thread: ThreadId) => lock.withPermit(openThreadBody(thread))
  const closeThread = (thread: ThreadId) => lock.withPermit(closeThreadBody(thread))

  const plan = resolve(plugins, new Set())
  let progressing = true
  while (progressing) {
    progressing = false
    for (const plugin of plan.order) {
      if ((yield* Ref.get(active)).has(plugin.id)) continue
      if (plugin.scope === 'thread') continue
      if (!(yield* Ref.get(desired)).has(plugin.id)) continue
      const result = yield* Effect.result(install(plugin))
      if (Result.isSuccess(result)) progressing = true
    }
  }
  yield* refreshBlocked()
  yield* runBootSteps()

  return {
    activate,
    deactivate,
    replace,
    openThread,
    closeThread,
    graph,
    graphFor,
    events: Stream.fromPubSub(pubsub),
    contributions: readContributions,
    service: (token, thread) =>
      Effect.suspend(() => {
        if (thread !== undefined) {
          const lane = Ref.getUnsafe(threadRegistries).get(thread)
          if (lane?.peek(token) !== undefined) return lane.get(token)
        }
        return registry.get(token)
      }),
    facade: (token, thread) => facade(token, thread),
  }
})
