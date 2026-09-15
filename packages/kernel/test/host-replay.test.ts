import { describe, expect, it } from 'vitest'
import { Predicate, Context, Effect, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import {
  definePlugin,
  defineService,
  foldActivePlugins,
  makeHost,
  SessionLog,
  sessionLogLayer,
  type SessionEvent,
} from '../src/index'

interface LoggerService {
  readonly log: (message: string) => Effect.Effect<void>
}

const Logger = defineService<LoggerService>('oru/logger')

interface GreeterService {
  readonly greet: (name: string) => Effect.Effect<string>
}

const Greeter = defineService<GreeterService>('oru/greeter')

const loggingPlugin = definePlugin({
  id: 'logging',
  provides: [Logger],
  server: {
    setup: () => Effect.succeed(Context.make(Logger, { log: () => Effect.void })),
  },
})

const greeterPlugin = definePlugin({
  id: 'greeter',
  needs: [Logger],
  provides: [Greeter],
  server: {
    setup: () =>
      Effect.succeed(
        Context.make(Greeter, {
          greet: (name) => Effect.succeed(`hello ${name}`),
        }),
      ),
  },
})

const pluginFacts = (events: readonly SessionEvent[]) => {
  const facts: Array<readonly [string, string]> = []
  for (const event of events) {
    if (
      Predicate.isTagged(event, 'plugin/activated') ||
      Predicate.isTagged(event, 'plugin/deactivated')
    ) {
      facts.push([event._tag, event.plugin])
    }
  }
  return facts
}

const runSession = <A, E>(
  effect: Effect.Effect<A, E, EventJournal.EventJournal | SessionLog | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    ),
  )

describe('host replay', () => {
  it('rebuilds the live graph from the journal without duplicating unchanged activations', async () => {
    await runSession(
      Effect.gen(function* () {
        const log = yield* SessionLog
        yield* Effect.scoped(
          Effect.gen(function* () {
            const host = yield* makeHost([greeterPlugin, loggingPlugin])
            expect([...(yield* host.graph).active.keys()].sort()).toEqual(['greeter', 'logging'])
          }),
        )
        const afterFirst = yield* log.entries
        expect(pluginFacts(afterFirst)).toEqual([
          ['plugin/activated', 'logging'],
          ['plugin/activated', 'greeter'],
        ])

        yield* Effect.scoped(
          Effect.gen(function* () {
            const host = yield* makeHost([greeterPlugin, loggingPlugin])
            const live = [...(yield* host.graph).active.keys()].sort()
            const folded = [...foldActivePlugins(yield* log.entries)].sort()
            expect(live).toEqual(['greeter', 'logging'])
            expect(folded).toEqual(live)
            expect(pluginFacts(yield* log.entries)).toEqual(pluginFacts(afterFirst))
          }),
        )
      }),
    )
  })

  it('keeps a recorded deactivation across a second host', async () => {
    await runSession(
      Effect.gen(function* () {
        const log = yield* SessionLog
        yield* Effect.scoped(
          Effect.gen(function* () {
            const host = yield* makeHost([greeterPlugin, loggingPlugin])
            yield* host.deactivate('logging')
          }),
        )
        const afterFirst = pluginFacts(yield* log.entries)
        expect(afterFirst).toEqual([
          ['plugin/activated', 'logging'],
          ['plugin/activated', 'greeter'],
          ['plugin/deactivated', 'greeter'],
          ['plugin/deactivated', 'logging'],
        ])

        yield* Effect.scoped(
          Effect.gen(function* () {
            const host = yield* makeHost([greeterPlugin, loggingPlugin])
            expect([...(yield* host.graph).active.keys()]).toEqual([])
            expect([...foldActivePlugins(yield* log.entries)]).toEqual([])
            expect(pluginFacts(yield* log.entries)).toEqual(afterFirst)
          }),
        )
      }),
    )
  })
})
