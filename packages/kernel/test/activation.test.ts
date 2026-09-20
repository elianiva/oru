import { describe, expect, it } from 'vitest'
import { Effect, Result, Schema } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import {
  DuplicateProvider,
  SessionLog,
  sessionLogLayer,
  defineContributionKind,
  definePlugin,
  defineService,
  makeHost,
} from '../src/index'

interface LoggerService {
  readonly log: (message: string) => Effect.Effect<void>
}

const Logger = defineService<LoggerService>('oru/logger')

interface GreeterService {
  readonly greet: (name: string) => Effect.Effect<string>
}

const Greeter = defineService<GreeterService>('oru/greeter')

const events: string[] = []

const loggingPlugin = definePlugin({
  id: 'logging',
  apply: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.provide(Logger, {
        log: (message) =>
          Effect.sync(() => {
            events.push(`log:${message}`)
          }),
      })
      yield* Effect.sync(() => {
        events.push('logger:open')
      })
      yield* ctx.effect(
        Effect.sync(() => {
          events.push('logger:close')
        }),
      )
    }),
})

const greeterPlugin = definePlugin({
  id: 'greeter',
  inject: [Logger],
  apply: (ctx) =>
    Effect.gen(function* () {
      const logger = yield* Logger
      yield* logger.log('greeter:up')
      yield* logger.log('greeter:ambient')
      yield* ctx.provide(Greeter, {
        greet: (name) => logger.log(`hello ${name}`).pipe(Effect.as(`hello ${name}`)),
      })
    }),
})

const Missing = defineService<{ readonly ping: Effect.Effect<void> }>('oru/missing')

const lonelyPlugin = definePlugin({
  id: 'lonely',
  inject: [Missing],
})

describe('kernel activation', () => {
  it('activates providers before consumers and reverses contributions on deactivation', async () => {
    events.length = 0
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([greeterPlugin, loggingPlugin])

          const booted = yield* host.graph
          expect(booted.active.has('logging')).toBe(true)
          expect(booted.active.has('greeter')).toBe(true)
          expect(booted.providers.get('oru/logger')).toBe('logging')
          expect(booted.providers.get('oru/greeter')).toBe('greeter')
          expect(events).toContain('logger:open')
          expect(events).toContain('log:greeter:up')
          expect(events).toContain('log:greeter:ambient')

          yield* host.deactivate('logging')

          const after = yield* host.graph
          expect(after.active.has('greeter')).toBe(false)
          expect(after.active.has('logging')).toBe(false)
          expect(after.providers.has('oru/logger')).toBe(false)
          expect(after.providers.has('oru/greeter')).toBe(false)
          expect(events.at(-1)).toBe('logger:close')
        }),
      ).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    )
  })

  it('keeps a plugin with unmet inject inactive until its provider appears', async () => {
    events.length = 0
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([greeterPlugin, lonelyPlugin])

          const blocked = yield* host.graph
          expect(blocked.active.has('greeter')).toBe(false)
          expect(blocked.blocked.get('greeter')?.missing).toEqual(['oru/logger'])
          expect(blocked.blocked.get('lonely')?.missing).toEqual(['oru/missing'])

          yield* host.activate(loggingPlugin)

          const live = yield* host.graph
          expect(live.active.has('greeter')).toBe(true)
          expect(live.active.has('logging')).toBe(true)
          expect(live.active.has('lonely')).toBe(false)
        }),
      ).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    )
  })

  it('records data contributions and reverses them with the plugin', async () => {
    const ToolKind = defineContributionKind<{ readonly name: string }>('oru/tool')

    const toolsPlugin = definePlugin({
      id: 'tools',
      apply: (ctx) => ctx.contribute(ToolKind.of({ name: 'search' })),
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([toolsPlugin])
          const before = yield* host.contributions(ToolKind)
          expect(before.map((c) => c.value.name)).toEqual(['search'])

          yield* host.deactivate('tools')
          const after = yield* host.contributions(ToolKind)
          expect(after).toEqual([])
        }),
      ).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    )
  })

  it('fails activation when two plugins provide the same service', async () => {
    const otherLogger = definePlugin({
      id: 'other-logger',
      apply: (ctx) => ctx.provide(Logger, { log: () => Effect.void }),
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([loggingPlugin])
          const result = yield* Effect.result(host.activate(otherLogger))
          expect(result).toEqual(
            Result.fail(
              new DuplicateProvider({
                token: 'oru/logger',
                existing: 'logging',
                incoming: 'other-logger',
              }),
            ),
          )
          expect((yield* host.graph).active.has('other-logger')).toBe(false)
        }),
      ).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    )
  })

  it('provides SessionLog to apply and resolves a provided service from the host', async () => {
    const probe = definePlugin({
      id: 'probe',
      apply: (ctx) =>
        Effect.gen(function* () {
          const log = yield* SessionLog
          yield* log.entries
          yield* ctx.provide(Logger, { log: () => Effect.void })
        }),
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([probe])
          const logger = yield* host.service(Logger)
          yield* logger.log('ok')
        }),
      ).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    )
  })

  it('decodes Config on the def and hands it to apply', async () => {
    const Seen = defineContributionKind<string>('oru/seen')
    const configured = definePlugin({
      id: 'configured',
      Config: Schema.Struct({ greeting: Schema.String }),
      apply: (ctx, config) => ctx.contribute(Seen.of(config.greeting)),
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([configured], new Map([['configured', { greeting: 'hi' }]]))
          expect((yield* host.contributions(Seen)).map((entry) => entry.value)).toEqual(['hi'])
        }),
      ).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    )
  })
})

describe('kernel thread-scoped activation', () => {
  const ToolKind = defineContributionKind<{ readonly name: string }>('oru/tool')

  const hostSearch = definePlugin({
    id: 'host-search',
    apply: (ctx) => ctx.contribute(ToolKind.of({ name: 'host-search' })),
  })

  const threadPing = definePlugin({
    id: 'thread-ping',
    scope: 'thread',
    apply: (ctx) =>
      Effect.gen(function* () {
        yield* ctx.contribute(ToolKind.of({ name: 'ping' }))
        yield* ctx.provide(Greeter, {
          greet: (name) => Effect.succeed(`ping ${name}`),
        })
        yield* Effect.sync(() => {
          events.push('ping:open')
        })
        yield* ctx.effect(
          Effect.sync(() => {
            events.push('ping:close')
          }),
        )
      }),
  })

  it('activates a thread-scoped plugin per thread and hides it from the host graph and siblings', async () => {
    events.length = 0
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([hostSearch, threadPing])
          const hostGraph = yield* host.graph
          expect(hostGraph.active.has('host-search')).toBe(true)
          expect(hostGraph.active.has('thread-ping')).toBe(false)
          expect((yield* host.contributions(ToolKind)).map((c) => c.value.name)).toEqual([
            'host-search',
          ])

          yield* host.openThread('own')
          yield* host.openThread('sibling')
          yield* host.activate(threadPing, 'own')

          const ownTools = (yield* host.contributions(ToolKind, 'own')).map((c) => c.value.name)
          expect(ownTools).toEqual(['host-search', 'ping'])
          const siblingTools = (yield* host.contributions(ToolKind, 'sibling')).map(
            (c) => c.value.name,
          )
          expect(siblingTools).toEqual(['host-search'])
          expect((yield* host.graphFor('own')).active.has('thread-ping')).toBe(true)
          expect((yield* host.graphFor('sibling')).active.has('thread-ping')).toBe(false)

          const greeter = yield* host.service(Greeter, 'own')
          expect(yield* greeter.greet('own')).toBe('ping own')

          yield* host.closeThread('own')
          expect((yield* host.contributions(ToolKind, 'own')).map((c) => c.value.name)).toEqual([
            'host-search',
          ])
          expect(events.filter((event) => event.startsWith('ping:'))).toEqual([
            'ping:open',
            'ping:close',
          ])
        }),
      ).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    )
  })

  it('does not give a subagent thread its parent thread-scoped tools', async () => {
    events.length = 0
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([threadPing])
          yield* host.openThread('parent')
          yield* host.activate(threadPing, 'parent')
          expect((yield* host.contributions(ToolKind, 'parent')).map((c) => c.value.name)).toEqual([
            'ping',
          ])
          expect(yield* (yield* host.service(Greeter, 'parent')).greet('parent')).toBe(
            'ping parent',
          )

          yield* host.openThread('subagent')
          expect(
            (yield* host.contributions(ToolKind, 'subagent')).map((c) => c.value.name),
          ).toEqual([])
        }),
      ).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    )
  })
})
