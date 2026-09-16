import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Predicate, Effect, type Scope } from 'effect'
import {
  SessionLog,
  sessionLogLayer,
  type SessionLogContract,
  type SessionLogError,
} from '@oru/kernel'
import { sqliteJournalLayer } from '@oru/kernel/sqlite'
import { ProjectClient, ThreadClient, clientsFor } from '@oru/rpc'
import { corePlugins, serveHost } from '../src/index.ts'

const sessionFile = (): string =>
  join(mkdtempSync(join(tmpdir(), 'oru-thread-config-')), 'session.db')

const withHost = <A, E>(
  file: string,
  effect: Effect.Effect<A, E, ProjectClient | ThreadClient | Scope.Scope>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const running = yield* serveHost({
        plugins: corePlugins,
        hostname: '127.0.0.1',
        port: 0,
        journal: file,
      })
      return yield* effect.pipe(Effect.provide(clientsFor(running.url)))
    }),
  )

const readJournal = <A>(
  file: string,
  read: (log: SessionLogContract) => Effect.Effect<A, SessionLogError>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const log = yield* SessionLog
        return yield* read(log)
      }).pipe(Effect.provide(sessionLogLayer), Effect.provide(sqliteJournalLayer(file))),
    ),
  )

const factsOf = (log: SessionLogContract, thread: string) =>
  log.entries.pipe(
    Effect.map((events) =>
      events.filter((event) => {
        if (Predicate.isTagged(event, 'thread/created')) return event.thread === thread
        if (Predicate.isTagged(event, 'thread/configured')) return event.thread === thread
        if (Predicate.isTagged(event, 'turn/started')) return event.thread === thread
        return false
      }),
    ),
  )

describe('a thread born configured', () => {
  it('writes one thread/configured carrying harness and model, before any turn', async () => {
    const file = sessionFile()
    const cwd = mkdtempSync(join(tmpdir(), 'oru-thread-config-cwd-'))

    const threadId = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const threads = yield* ThreadClient
          const project = yield* projects.create('demo', cwd)
          const created = yield* threads.create(project.id, {
            harness: 'oru',
            model: 'claude-sonnet-4',
          })
          return created.threadId
        }),
      ),
    )

    const facts = await readJournal(file, (log) => factsOf(log, threadId))
    expect(facts.map((event) => event._tag)).toEqual(['thread/created', 'thread/configured'])

    const configured = facts.find((event) => Predicate.isTagged(event, 'thread/configured'))
    if (configured === undefined || !Predicate.isTagged(configured, 'thread/configured')) {
      expect.fail('the journal has no thread/configured for the thread')
    }
    expect(configured.harness).toBe('oru')
    expect(configured.model).toBe('claude-sonnet-4')
    expect(configured.reasoning).toBeUndefined()
  })

  it('leaves a thread created with no configuration unconfigured', async () => {
    const file = sessionFile()
    const cwd = mkdtempSync(join(tmpdir(), 'oru-thread-plain-cwd-'))

    const threadId = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const threads = yield* ThreadClient
          const project = yield* projects.create('demo', cwd)
          const created = yield* threads.create(project.id)
          return created.threadId
        }),
      ),
    )

    const facts = await readJournal(file, (log) => factsOf(log, threadId))
    expect(facts.map((event) => event._tag)).toEqual(['thread/created'])
  })

  it('reports the configuration, the active harness, and its catalogue', async () => {
    const file = sessionFile()
    const cwd = mkdtempSync(join(tmpdir(), 'oru-thread-options-cwd-'))

    await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const threads = yield* ThreadClient
          const project = yield* projects.create('demo', cwd)
          const created = yield* threads.create(project.id, {
            harness: 'oru',
            model: 'claude-sonnet-4',
            reasoning: undefined,
          })

          const options = yield* threads.options(created.threadId)
          expect(options.config).toEqual({
            harness: 'oru',
            model: 'claude-sonnet-4',
            reasoning: undefined,
          })
          expect(options.harness).toBe('oru')
          expect(options.models.map((model) => model.id)).toEqual([
            'mock',
            'gpt-5.4-mini',
            'claude-sonnet-4',
          ])

          // A thread that does not exist yet answers with the host's default.
          const fresh = yield* threads.options(undefined)
          expect(fresh.config).toEqual({
            harness: undefined,
            model: undefined,
            reasoning: undefined,
          })
          expect(fresh.harness).toBe('oru')
          expect(fresh.models.map((model) => model.id)).toHaveLength(3)
        }),
      ),
    )
  })
})
