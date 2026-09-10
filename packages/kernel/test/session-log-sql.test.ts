import { describe, expect, it } from 'vitest'
import { Effect, type Scope } from 'effect'
import { EventJournal, SqlEventJournal } from 'effect/unstable/eventlog'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { foldActivePlugins, foldNamedThreads, SessionLog, sessionLogLayer } from '../src/index'
import { PluginActivated, ThreadCreated } from '../src/session-event.ts'

const runSql = <A, E>(
  effect: Effect.Effect<A, E, EventJournal.EventJournal | SessionLog | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(
        Effect.provide(sessionLogLayer),
        Effect.provide(SqlEventJournal.layer()),
        Effect.provide(SqliteClient.layer({ filename: ':memory:' })),
      ),
    ),
  )

describe('sql session log', () => {
  it('writes through SQLite EventJournal and folds the same SessionLog', async () => {
    await runSql(
      Effect.gen(function* () {
        const log = yield* SessionLog
        yield* log.write(PluginActivated.make({ plugin: 'logging', scope: 'host' }))
        yield* log.write(ThreadCreated.make({ id: 'e1', thread: 't1' }))
        const entries = yield* log.entries
        expect([...foldActivePlugins(entries)]).toEqual(['logging'])
        expect([...foldNamedThreads(entries)]).toEqual(['t1'])
        expect(entries.map((event) => event._tag)).toEqual(['plugin/activated', 'thread/created'])
      }),
    )
  })
})
