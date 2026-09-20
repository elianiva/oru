/**
 * Compile-time contract for `inject`/`apply`, in the spirit of Effect's `typetest/` files.
 *
 * Nothing here runs: vitest does not match this path, but `tsc` does, so an `@ts-expect-error`
 * that stops being an error fails `pnpm typecheck`. Providing is runtime-discovered through
 * `ctx.provide`, so the checks below are about what `apply` may read and return, not about
 * a pre-declared `provides` list.
 */
import { Effect, Schema } from 'effect'
import { definePlugin, defineService, type ServiceProvisions } from '../../src/index.ts'

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

interface LoggerService {
  readonly log: (message: string) => void
}
const Logger = defineService<LoggerService>('oru/logger')

interface GreeterService {
  readonly greet: () => void
}
const Greeter = defineService<GreeterService>('oru/greeter')

export const provisionsAreTheIdentifier: Equal<
  ServiceProvisions<[typeof Logger]>,
  LoggerService
> = true

export const supplies = definePlugin({
  id: 'supplies',
  apply: (ctx) => ctx.provide(Logger, { log: () => {} }),
})

export const readsInject = definePlugin({
  id: 'reads-inject',
  inject: [Logger],
  apply: (ctx) =>
    Effect.gen(function* () {
      const logger = yield* Logger
      yield* ctx.provide(Greeter, { greet: () => logger.log('hi') })
    }),
})

export const unlistedInject = definePlugin({
  id: 'unlisted-inject',
  // @ts-expect-error apply must not read a service the inject list does not name
  apply: () =>
    Effect.gen(function* () {
      yield* Greeter
    }),
})

export const returnsValue = definePlugin({
  id: 'returns-value',
  // @ts-expect-error apply returns void; services leave through ctx.provide
  apply: () => ({ extra: true }),
})

export const configMatchesApply = definePlugin({
  id: 'config-matches-apply',
  Config: Schema.Struct({ greeting: Schema.String }),
  apply: (ctx, config) => ctx.provide(Greeter, { greet: () => config.greeting }),
})

export const configMismatch = definePlugin({
  id: 'config-mismatch',
  Config: Schema.Struct({ greeting: Schema.String }),
  // @ts-expect-error apply receives the Config the def declares
  apply: (_ctx, _config: number) => Effect.void,
})
