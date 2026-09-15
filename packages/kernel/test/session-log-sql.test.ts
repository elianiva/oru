import { describe, expect, it } from 'vitest'
import { Clock, Effect, type Scope } from 'effect'
import { EventJournal, SqlEventJournal } from 'effect/unstable/eventlog'
import { SqliteClient } from '@effect/sql-sqlite-node'
import {
  foldActivePlugins,
  foldNamedThreads,
  MessageAppended,
  pathOfLane,
  SessionActivated,
  SessionLog,
  sessionLogLayer,
  threadLane,
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

/** One instant for every write, so the journal's row order is all that is left. */
const frozenClock: Clock.Clock = {
  currentTimeMillisUnsafe: () => 1_000,
  currentTimeMillis: Effect.succeed(1_000),
  monotonicTimeNanosUnsafe: () => 1_000_000_000n,
  monotonicTimeNanos: Effect.succeed(1_000_000_000n),
  currentTimeNanosUnsafe: () => 1_000_000_000n,
  currentTimeNanos: Effect.succeed(1_000_000_000n),
  sleep: () => Effect.void,
}

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

  it('reads the journal back in append order when every fact shares a timestamp', async () => {
    await runSql(
      Effect.gen(function* () {
        const log = yield* SessionLog
        const written: string[] = []
        for (let index = 0; index < 120; index++) {
          const id = `e${index}`
          written.push(id)
          yield* log.write(
            MessageAppended.make({
              ...unsignedTree,
              id,
              thread: 't1',
              role: 'user',
              body: `m${index}`,
            }),
          )
        }
        const entries = yield* log.entries
        // The journal orders by millisecond, and every fact here carries the
        // same one. `write` stamps `parentId` from the lane leaf of the order it
        // reads back, so a journal that returned those ties in another order
        // would chain the lane wrongly and every projection after it would
        // follow.
        expect(new Set(entries.map((event) => event.timestamp)).size).toBe(1)
        expect(entries.map((event) => event.id)).toEqual(written)
        expect(entries.slice(1).map((event) => event.parentId)).toEqual(written.slice(0, -1))
        expect(pathOfLane(entries, threadLane('t1')).map((event) => event.id)).toEqual(written)
      }).pipe(Effect.provideService(Clock.Clock, frozenClock)),
    )
  })
})
