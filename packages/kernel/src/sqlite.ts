import { SqliteClient } from '@effect/sql-sqlite-node'
import { Effect, Layer } from 'effect'
import { EventJournal, SqlEventJournal } from 'effect/unstable/eventlog'
import { SqlClient } from 'effect/unstable/sql/SqlClient'
import type { SqlError } from 'effect/unstable/sql/SqlError'
import { layer as sessionLogLayer, SessionLog } from './session-log.ts'
import {
  applyPending,
  inspectReadonlyLedger,
  SchemaDiverged,
  SchemaTooNew,
} from './sqlite-migrate.ts'

export { SchemaDiverged, SchemaTooNew } from './sqlite-migrate.ts'

export type JournalOpenError = SchemaTooNew | SchemaDiverged | SqlError

const sqliteClientJournal = (
  filename: string,
): Layer.Layer<EventJournal.EventJournal, JournalOpenError> =>
  Layer.effect(
    EventJournal.EventJournal,
    Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* applyPending(sql, filename)
      return yield* SqlEventJournal.make()
    }),
  ).pipe(Layer.provide(SqliteClient.layer({ filename })))

/**
 * The journal a node host keeps on disk: one append-only SQLite file that
 * outlives the process. Opening it twice against the same file is the restart
 * case. This stays a node entry point (`@oru/kernel/sqlite`) so a browser host
 * never pulls a filesystem driver into its bundle (ADR-0010).
 */
export const sqliteJournalLayer = (
  filename: string,
): Layer.Layer<EventJournal.EventJournal, JournalOpenError> =>
  Layer.unwrap(inspectReadonlyLedger(filename).pipe(Effect.as(sqliteClientJournal(filename))))

export const sessionLogLayerSqlite = (
  filename: string,
): Layer.Layer<SessionLog | EventJournal.EventJournal, JournalOpenError> =>
  sessionLogLayer.pipe(Layer.provideMerge(sqliteJournalLayer(filename)))
