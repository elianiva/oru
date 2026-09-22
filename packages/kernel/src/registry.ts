import { Effect, Option, Predicate, PubSub, Ref, Stream } from 'effect'
import { ProviderReturnKindChanged, ProviderUnavailable } from './errors.ts'
import { ProviderRemoved, type HostEvent } from './event.ts'
import type { PluginId, TokenId } from './primitives.ts'
import { serviceId, type AnyServiceToken, type ServiceOf, type ServiceToken } from './service.ts'

interface Cell {
  readonly owner: PluginId
  readonly impl: Ref.Ref<unknown>
}

/**
 * What a service method answers: one of the two descriptions a contract may
 * return. The facade reads the kind off a call, so it has to name the kinds it
 * can hand back.
 */
type ServiceAnswer =
  | Effect.Effect<unknown, unknown, unknown>
  | Stream.Stream<unknown, unknown, unknown>

type ServiceMethod = (...args: ReadonlyArray<unknown>) => ServiceAnswer

export interface Registry {
  readonly events: Stream.Stream<HostEvent>
  /**
   * No provider is a state of the host, not a broken invariant: activation is
   * replayed from the journal, a provider can be toggled offline, and a blocked
   * plugin never registers. It fails typed so the boundary above can render it.
   */
  readonly get: <S>(token: ServiceToken<S>) => Effect.Effect<S, ProviderUnavailable>
  /**
   * The provider in the cell right now, for callers that cannot wait for an
   * `Effect`: a facade has to hand back the kind of value the contract promises.
   */
  readonly peek: <S>(token: ServiceToken<S>) => S | undefined
  readonly has: (token: AnyServiceToken) => Effect.Effect<boolean>
  readonly providers: Effect.Effect<ReadonlyMap<string, PluginId>>
  readonly provide: <S>(token: ServiceToken<S>, value: S, owner: PluginId) => Effect.Effect<void>
  readonly remove: (token: AnyServiceToken, owner: PluginId) => Effect.Effect<void>
}

/**
 * A live stand-in for a service, bound to whatever is in the cell right now.
 *
 * Setup captures the facade rather than the value, so a provider replaced later
 * is seen by its dependents without re-running their setup. A call resolves the
 * implementation twice by design: once to see which kind of description the
 * method builds, and once when that description runs. Calling a method is
 * building a description, not doing the work, so the probe is free.
 *
 * The kind is preserved because `Effect.flatMap` would otherwise swallow a
 * `Stream` (and a harness that streams through a facade is
 * the normal case, not an exotic one).
 *
 * A miss here still dies rather than failing typed: the facade is handed to a
 * consumer whose `inject` the kernel satisfied before `apply` ran, and it is
 * cast to `S`, whose method signatures cannot carry a registry failure. A live
 * consumer finding no provider is that invariant breaking, and a plugin call
 * has no client to render a state to. The typed path is `Registry.get`, which
 * handlers reach through `host.service`.
 */
export const serviceFacade = <S>(peek: () => S | undefined, token: TokenId): S => {
  const live = (): Effect.Effect<S> =>
    Effect.suspend(() => {
      const impl = peek()
      if (impl === undefined) return Effect.die(new ProviderUnavailable({ token }))
      return Effect.succeed(impl)
    })
  const call = (impl: S, property: string, args: ReadonlyArray<unknown>): ServiceAnswer => {
    // SAFETY: live service values are method bags keyed by the token interface
    const methods = impl as Readonly<Record<string, ServiceMethod | undefined>>
    return methods[property]!(...args)
  }
  const again = (property: string, args: ReadonlyArray<unknown>): Effect.Effect<ServiceAnswer> =>
    Effect.map(live(), (current) => call(current, property, args))

  const target = Object.create(null)
  const facade = new Proxy(target, {
    get: (_target, property) => {
      if (!Predicate.isString(property)) return undefined
      return (...args: ReadonlyArray<unknown>) => {
        const impl = peek()
        if (impl === undefined) throw new ProviderUnavailable({ token })
        const sample = call(impl, property, args)
        const next = again(property, args)
        if (Effect.isEffect(sample)) {
          return Effect.flatMap(next, (value) =>
            Effect.isEffect(value) ? value : Effect.die(new ProviderReturnKindChanged({ token })),
          )
        }
        return Stream.unwrap(
          Effect.map(next, (value) =>
            Stream.isStream(value) ? value : Stream.die(new ProviderReturnKindChanged({ token })),
          ),
        )
      }
    },
  })
  // SAFETY: the proxy forwards string methods to the live cell for token S
  return facade as S
}

export const openRegistry = Effect.fnUntraced(function* (events: PubSub.PubSub<HostEvent>) {
  const cells = yield* Ref.make<ReadonlyMap<string, Cell>>(new Map())

  const get = Effect.fnUntraced(function* <S>(token: ServiceToken<S>) {
    const map = yield* Ref.get(cells)
    const cell = Option.fromNullishOr(map.get(serviceId(token)))
    if (Option.isNone(cell))
      return yield* Effect.fail(new ProviderUnavailable({ token: serviceId(token) }))
    const value = yield* Ref.get(cell.value.impl)
    // SAFETY: provide stores the value under the same token key get reads
    return value as ServiceOf<typeof token>
  })

  const has = (token: AnyServiceToken): Effect.Effect<boolean> =>
    Ref.get(cells).pipe(Effect.map((map) => map.has(serviceId(token))))

  const peek = <S>(token: ServiceToken<S>): S | undefined => {
    const cell = Ref.getUnsafe(cells).get(serviceId(token))
    if (cell === undefined) return undefined
    // SAFETY: provide stores the value under the same token key peek reads
    return Ref.getUnsafe(cell.impl) as S
  }

  const providers = Ref.get(cells).pipe(
    Effect.map((map) => {
      const out = new Map<string, PluginId>()
      for (const [key, cell] of map) out.set(key, cell.owner)
      return out
    }),
  )

  const provide = Effect.fnUntraced(function* <S>(
    token: ServiceToken<S>,
    value: S,
    owner: PluginId,
  ) {
    const key = serviceId(token)
    const map = yield* Ref.get(cells)
    const existing = map.get(key)
    if (existing !== undefined) {
      yield* Ref.set(existing.impl, value)
      if (existing.owner !== owner) {
        yield* Ref.update(cells, (current) => {
          const next = new Map(current)
          next.set(key, { owner, impl: existing.impl })
          return next
        })
      }
      return
    }
    const impl = yield* Ref.make<unknown>(value)
    yield* Ref.update(cells, (current) => {
      const next = new Map(current)
      next.set(key, { owner, impl })
      return next
    })
  })

  const remove = Effect.fnUntraced(function* (token: AnyServiceToken, owner: PluginId) {
    yield* Ref.update(cells, (map) => {
      const cell = map.get(serviceId(token))
      if (cell === undefined || cell.owner !== owner) return map
      const next = new Map(map)
      next.delete(serviceId(token))
      return next
    })
    yield* PubSub.publish(events, ProviderRemoved.make({ token: serviceId(token), plugin: owner }))
  })

  return { events: Stream.fromPubSub(events), get, has, peek, providers, provide, remove }
})
