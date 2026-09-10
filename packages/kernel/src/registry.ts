import { Effect, Option, PubSub, Ref, Stream } from "effect"
import { ProviderUnavailable } from "./errors.ts"
import { ProviderRemoved, type HostEvent } from "./event.ts"
import type { PluginId } from "./primitives.ts"
import { serviceId, type AnyServiceToken, type ServiceShape, type ServiceToken } from "./service.ts"

interface Cell {
  readonly owner: PluginId
  readonly impl: Ref.Ref<unknown>
}

export interface Registry {
  readonly events: Stream.Stream<HostEvent>
  readonly get: <S>(token: ServiceToken<S>) => Effect.Effect<S>
  readonly has: (token: AnyServiceToken) => Effect.Effect<boolean>
  readonly providers: Effect.Effect<ReadonlyMap<string, PluginId>>
  readonly provide: (token: AnyServiceToken, value: unknown, owner: PluginId) => Effect.Effect<void>
  readonly remove: (token: AnyServiceToken, owner: PluginId) => Effect.Effect<void>
}

export const makeFacade = <S>(get: Effect.Effect<S>): S =>
  new Proxy({} as Record<PropertyKey, unknown>, {
    get: (_target, property) => {
      if (typeof property === "symbol") return undefined
      return (...args: ReadonlyArray<unknown>) =>
        Effect.flatMap(get, (impl) => {
          const method = (impl as Record<string, (...a: ReadonlyArray<unknown>) => Effect.Effect<unknown>>)[property]
          return method!(...args)
        })
    },
  }) as S

export const makeRegistry = (events: PubSub.PubSub<HostEvent>): Effect.Effect<Registry> =>
  Effect.gen(function* () {
    const cells = yield* Ref.make<ReadonlyMap<string, Cell>>(new Map())

    const get = <S>(token: ServiceToken<S>): Effect.Effect<S> =>
      Effect.gen(function* () {
        const map = yield* Ref.get(cells)
        const cell = Option.fromNullishOr(map.get(serviceId(token)))
        if (Option.isNone(cell)) return yield* Effect.die(new ProviderUnavailable({ token: serviceId(token) }))
        return (yield* Ref.get(cell.value.impl)) as ServiceShape<typeof token>
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

    const provide = (token: AnyServiceToken, value: unknown, owner: PluginId): Effect.Effect<void> =>
      Effect.gen(function* () {
        const impl = yield* Ref.make(value)
        yield* Ref.update(cells, (map) => {
          const next = new Map(map)
          next.set(serviceId(token), { owner, impl })
          return next
        })
      })

    const remove = (token: AnyServiceToken, owner: PluginId): Effect.Effect<void> =>
      Effect.gen(function* () {
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
