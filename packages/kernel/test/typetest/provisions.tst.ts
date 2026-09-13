/**
 * Compile-time contract for `provides`/`setup`, in the spirit of Effect's `typetest/` files.
 *
 * Nothing here runs: vitest does not match this path, but `tsc` does, so an `@ts-expect-error`
 * that stops being an error fails `pnpm typecheck`. That is the point. The checks below are
 * type-level facts about the kernel, not behavior.
 */
import { Context, Effect } from 'effect'
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

/**
 * `defineService` keeps the identifier precise. With `Context.Service<any, S>` this reads `any`,
 * every `@ts-expect-error` below goes unused, and the whole file collapses.
 */
export const provisionsAreTheIdentifier: Equal<
  ServiceProvisions<[typeof Logger]>,
  LoggerService
> = true

export const supplies = definePlugin({
  id: 'supplies',
  provides: [Logger],
  server: { setup: () => Effect.succeed(Context.make(Logger, { log: () => {} })) },
})

export const omits = definePlugin({
  id: 'omits',
  provides: [Logger],
  server: {
    // @ts-expect-error setup must return the service the declaration claims
    setup: () => Effect.succeed(Context.empty()),
  },
})

export const substitutes = definePlugin({
  id: 'substitutes',
  provides: [Logger],
  server: {
    // @ts-expect-error setup must not substitute a different service
    setup: () => Effect.succeed(Context.make(Greeter, { greet: () => {} })),
  },
})

export const partial = definePlugin({
  id: 'partial',
  provides: [Logger, Greeter],
  server: {
    // @ts-expect-error setup must supply every declared service, not just one of them
    setup: () => Effect.succeed(Context.make(Logger, { log: () => {} })),
  },
})

export const undeclaredCoeffect = definePlugin({
  id: 'undeclared-coeffect',
  needs: [Logger],
  provides: [Logger],
  server: {
    // @ts-expect-error setup must not yield a coeffect the declaration does not list
    setup: () =>
      Effect.gen(function* () {
        yield* Greeter
        return Context.make(Logger, { log: () => {} })
      }),
  },
})

/**
 * The converse is *not* a type error: `Context<Services>` is contravariant, so a setup returning
 * more than it declared still satisfies the declaration. `host` rejects that at activation with
 * `ServiceUndeclared` (see `test/activation.test.ts`).
 */
export const extraProvision = definePlugin({
  id: 'extra-provision',
  provides: [Logger],
  server: {
    setup: () =>
      Effect.succeed(
        Context.merge(
          Context.make(Logger, { log: () => {} }),
          Context.make(Greeter, { greet: () => {} }),
        ),
      ),
  },
})
