import { describe, expect, it } from 'vitest'
import { Context, Effect, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import {
  definePlugin,
  defineService,
  foldActivePlugins,
  makeHost,
  provide,
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
  provides: [provide(Logger)],
  server: {
    setup: () => Effect.succeed(Context.make(Logger, { log: () => Effect.void })),
  },
})

const greeterPlugin = definePlugin({
  id: 'greeter',
  needs: [Logger],
  provides: [provide(Greeter)],
  server: {
    setup: () =>
      Effect.succeed(
        Context.make(Greeter, {
          greet: (name) => Effect.succeed(`hello ${name}`),
        }),
      ),
  },
})

const pluginField = (event: SessionEvent, field: 'plugin' | 'scope'): string => {
  switch (event._tag) {
    case 'plugin/activated':
    case 'plugin/deactivated':
      return event[field]
    default:
      return ''
  }
}

const runSession = <A, E>(
  effect: Effect.Effect<A, E, EventJournal.EventJournal | SessionLog | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    ),
  )

describe('session log', () => {
  it('records boot activations in provider-before-consumer order and reprojects after deactivation', async () => {
    await runSession(
      Effect.gen(function* () {
        const host = yield* makeHost([greeterPlugin, loggingPlugin])
        const log = yield* SessionLog

        const booted = yield* log.entries
        expect(booted.map((event) => event._tag)).toEqual(['plugin/activated', 'plugin/activated'])
        expect(booted.map((event) => pluginField(event, 'plugin'))).toEqual(['logging', 'greeter'])
        expect(booted.map((event) => pluginField(event, 'scope'))).toEqual(['host', 'host'])

        const graphAtBoot = yield* host.graph
        expect([...foldActivePlugins(booted)].sort()).toEqual([...graphAtBoot.active.keys()].sort())

        yield* host.deactivate('logging')

        const after = yield* log.entries
        expect(after.map((event) => [event._tag, pluginField(event, 'plugin')])).toEqual([
          ['plugin/activated', 'logging'],
          ['plugin/activated', 'greeter'],
          ['plugin/deactivated', 'greeter'],
          ['plugin/deactivated', 'logging'],
        ])

        const graphAfter = yield* host.graph
        expect([...foldActivePlugins(after)]).toEqual([...graphAfter.active.keys()])
      }),
    )
  })

  it('records a consumer flipping live when its provider appears and disappears', async () => {
    await runSession(
      Effect.gen(function* () {
        const host = yield* makeHost([greeterPlugin])
        const log = yield* SessionLog

        const blocked = yield* host.graph
        expect(blocked.active.has('greeter')).toBe(false)
        expect(yield* log.entries).toEqual([])

        yield* host.activate(loggingPlugin)

        const live = yield* host.graph
        expect(live.active.has('logging')).toBe(true)
        expect(live.active.has('greeter')).toBe(true)

        const up = yield* log.entries
        expect(up.map((event) => [event._tag, pluginField(event, 'plugin')])).toEqual([
          ['plugin/activated', 'logging'],
          ['plugin/activated', 'greeter'],
        ])

        yield* host.deactivate('logging')
        yield* host.activate(loggingPlugin)

        const again = yield* log.entries
        expect(again.map((event) => [event._tag, pluginField(event, 'plugin')])).toEqual([
          ['plugin/activated', 'logging'],
          ['plugin/activated', 'greeter'],
          ['plugin/deactivated', 'greeter'],
          ['plugin/deactivated', 'logging'],
          ['plugin/activated', 'logging'],
          ['plugin/activated', 'greeter'],
        ])
      }),
    )
  })
})
