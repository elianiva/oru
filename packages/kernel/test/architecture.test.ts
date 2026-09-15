import { describe, expect, it } from 'vitest'
import { Context, Effect, Fiber, Match, Stream, type Scope } from 'effect'
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

const sessionTags = (events: readonly SessionEvent[]): readonly string[] =>
  events.map((event) =>
    Match.value(event).pipe(
      Match.tagsExhaustive({
        'plugin/activated': (event) => `${event._tag}:${event.plugin}`,
        'plugin/deactivated': (event) => `${event._tag}:${event.plugin}`,
        'thread/created': (event) => event._tag,
        'thread/configured': (event) => event._tag,
        'project/created': (event) => event._tag,
        'turn/started': (event) => event._tag,
        'turn/failed': (event) => event._tag,
        'turn/usage': (event) => event._tag,
        'thread/context-window': (event) => event._tag,
        'message/appended': (event) => event._tag,
        'tool/requested': (event) => event._tag,
        'tool/completed': (event) => event._tag,
        'approval/decided': (event) => event._tag,
        'thread/compacted': (event) => event._tag,
        'thread/branched': (event) => event._tag,
        'agent/inbox/spliced': (event) => event._tag,
      }),
    ),
  )

const run = <A, E>(
  effect: Effect.Effect<A, E, EventJournal.EventJournal | SessionLog | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    ),
  )

describe('kernel architecture', () => {
  it('registers plugins, streams journal facts, and reconstructs the active set from the log', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([greeterPlugin])
        const log = yield* SessionLog
        const liveLog = yield* log.subscribe
        const logFiber = yield* liveLog.pipe(Stream.take(4), Stream.runCollect, Effect.forkScoped)

        const blocked = yield* host.graph
        expect(blocked.active.has('greeter')).toBe(false)
        expect(blocked.blocked.get('greeter')?.missing).toEqual(['oru/logger'])
        expect(yield* log.entries).toEqual([])

        yield* host.activate(loggingPlugin)

        const live = yield* host.graph
        const fromLog = foldActivePlugins(yield* log.entries)
        expect([...live.active.keys()].sort()).toEqual(['greeter', 'logging'])
        expect([...fromLog].sort()).toEqual([...live.active.keys()].sort())

        const greeter = yield* host.service(Greeter)
        expect(yield* greeter.greet('oru')).toBe('hello oru')

        yield* host.deactivate('logging')

        const streamed = yield* Fiber.join(logFiber)
        expect(sessionTags(streamed)).toEqual([
          'plugin/activated:logging',
          'plugin/activated:greeter',
          'plugin/deactivated:greeter',
          'plugin/deactivated:logging',
        ])

        const after = yield* log.entries
        const graphAfter = yield* host.graph
        expect([...foldActivePlugins(after)]).toEqual([])
        expect([...graphAfter.active.keys()]).toEqual([])
      }),
    )
  })
})
