import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Clock, Effect, Schema, type Scope } from 'effect'
import { EventJournal, SqlEventJournal } from 'effect/unstable/eventlog'
import { SqlClient } from 'effect/unstable/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { pack } from 'msgpackr'
import {
  foldActivePlugins,
  foldNamedThreads,
  foldThreadContextWindow,
  foldThreadUsage,
  MessageAppended,
  pathOfLane,
  SessionActivated,
  SessionEvent,
  SessionLog,
  sessionLogLayer,
  threadLane,
  ThreadContextWindow,
  ThreadCreated,
  TurnUsage,
  unsignedTree,
} from '../src/index'
import { sqliteJournalLayer } from '../src/sqlite.ts'

const runSql = <A, E>(
  effect: Effect.Effect<A, E, EventJournal.EventJournal | SessionLog | SqlClient | Scope.Scope>,
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

  it('reprojects usage from a file after the writer process is gone', async () => {
    const file = `/tmp/oru-usage-${Date.now().toString(36)}.db`
    const withFile = <A, E>(
      effect: Effect.Effect<A, E, EventJournal.EventJournal | SessionLog | Scope.Scope>,
    ) =>
      Effect.runPromise(
        Effect.scoped(
          effect.pipe(Effect.provide(sessionLogLayer), Effect.provide(sqliteJournalLayer(file))),
        ),
      )

    await withFile(
      Effect.gen(function* () {
        const log = yield* SessionLog
        yield* log.write(
          ThreadCreated.make({
            ...unsignedTree,
            id: 'e0',
            thread: 't1',
            project: 'p1',
          }),
        )
        yield* log.write(
          TurnUsage.make({
            ...unsignedTree,
            id: 'e1',
            thread: 't1',
            turn: 'turn-1',
            inputTokens: 11,
            outputTokens: 3,
            cost: 0.04,
          }),
        )
        yield* log.write(
          ThreadContextWindow.make({
            ...unsignedTree,
            id: 'e2',
            thread: 't1',
            tokens: 40,
            contextWindow: 128_000,
          }),
        )
      }),
    )

    const replayed = await withFile(
      Effect.gen(function* () {
        const log = yield* SessionLog
        const entries = yield* log.entries
        return {
          usage: foldThreadUsage(entries, 't1'),
          context: foldThreadContextWindow(entries, 't1'),
        }
      }),
    )
    expect(replayed.usage).toEqual({ inputTokens: 11, outputTokens: 3, cost: 0.04 })
    expect(replayed.context).toEqual({ tokens: 40, contextWindow: 128_000 })
  })

  it('reads facts the legacy MessagePack codec wrote before the SchemaBinary switch', async () => {
    await runSql(
      Effect.gen(function* () {
        const sql = yield* SqlClient
        const stamped = {
          ...SessionActivated.make({
            ...unsignedTree,
            id: 'legacy-0',
            plugin: 'logging',
            scope: 'host',
          }),
          parentId: null,
          seq: 0,
          timestamp: 1_000,
        }
        // What `Msgpack.schema(SessionEvent)` on effect rc.112 stored: the
        // schema-encoded value packed as MessagePack.
        const legacy = Buffer.from(pack(Schema.encodeSync(SessionEvent)(stamped)))
        yield* sql`INSERT INTO ${sql('effect_event_journal')} ${sql.insert({
          id: randomBytes(16),
          event: 'plugin/activated',
          primary_key: 'legacy-0',
          payload: legacy,
          timestamp: 1_000,
        })}`
        const entries = yield* (yield* SessionLog).entries
        expect(entries.map((entry) => entry.id)).toEqual(['legacy-0'])
        expect(entries[0]?._tag).toBe('plugin/activated')
        expect([...foldActivePlugins(entries)]).toEqual(['logging'])
      }),
    )
  })
})
