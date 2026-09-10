import { Effect, Option, Predicate, PubSub, Ref, Stream } from 'effect'
import { ProviderUnavailable } from './errors.ts'
import { ProviderRemoved, type HostEvent } from './event.ts'
import type { PluginId } from './primitives.ts'
import { serviceId, type AnyServiceToken, type ServiceOf, type ServiceToken } from './service.ts'

interface Cell {
  readonly owner: PluginId
  readonly impl: Ref.Ref<unknown>
}

type ServiceMethod = (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown>

export interface Registry {
  readonly events: Stream.Stream<HostEvent>
  readonly get: <S>(token: ServiceToken<S>) => Effect.Effect<S>
  readonly has: (token: AnyServiceToken) => Effect.Effect<boolean>
  readonly providers: Effect.Effect<ReadonlyMap<string, PluginId>>
  readonly provide: <S>(token: ServiceToken<S>, value: S, owner: PluginId) => Effect.Effect<void>
  readonly remove: (token: AnyServiceToken, owner: PluginId) => Effect.Effect<void>
}

export const serviceFacade = <S>(get: Effect.Effect<S>): S => {
  const target = Object.create(null)
  const facade = new Proxy(target, {
    get: (_target, property) => {
      if (!Predicate.isString(property)) return undefined
      return (...args: ReadonlyArray<unknown>) =>
        Effect.flatMap(get, (impl) => {
          // SAFETY: live service values are method bags keyed by the token interface
          const methods = impl as Record<string, ServiceMethod | undefined>
          const method = methods[property]
          return method!(...args)
        })
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
      return yield* Effect.die(new ProviderUnavailable({ token: serviceId(token) }))
    const value = yield* Ref.get(cell.value.impl)
    // SAFETY: provide stores the value under the same token key get reads
    return value as ServiceOf<typeof token>
  })

  const has = (token: AnyServiceToken): Effect.Effect<boolean> =>
    Ref.get(cells).pipe(Effect.map((map) => map.has(serviceId(token))))

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
    const impl = yield* Ref.make<unknown>(value)
    yield* Ref.update(cells, (map) => {
      const next = new Map(map)
      next.set(serviceId(token), { owner, impl })
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

  return { events: Stream.fromPubSub(events), get, has, providers, provide, remove }
})
