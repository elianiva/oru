import { describe, expect, it } from 'vitest'
import { Effect, type Scope } from 'effect'
import { EventJournal, SqlEventJournal } from 'effect/unstable/eventlog'
import { SqliteClient } from '@effect/sql-sqlite-node'
import {
  foldActivePlugins,
  foldNamedThreads,
  SessionActivated,
  SessionLog,
  sessionLogLayer,
  ThreadCreated,
  unsignedTree,
} from '../src/index'

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
        yield* log.write(
          SessionActivated.make({
            ...unsignedTree,
            id: 'e0',
            plugin: 'logging',
            scope: 'host',
          }),
        )
        yield* log.write(
          ThreadCreated.make({
            ...unsignedTree,
            id: 'e1',
            thread: 't1',
            project: 'p1',
          }),
        )
        const entries = yield* log.entries
        expect([...foldActivePlugins(entries)]).toEqual(['logging'])
        expect([...foldNamedThreads(entries)]).toEqual(['t1'])
        expect(entries.map((event) => event._tag)).toEqual(['plugin/activated', 'thread/created'])
        expect(entries[0]?.parentId).toBeNull()
        expect(entries[1]?.parentId).toBeNull()
        expect(entries[1]?.seq).toBe(1)
      }),
    )
  })
})
