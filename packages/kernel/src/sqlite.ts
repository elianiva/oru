import { SqliteClient } from '@effect/sql-sqlite-node'
import { Layer } from 'effect'
import { SqlEventJournal } from 'effect/unstable/eventlog'

/**
 * The journal a node host keeps on disk: one append-only SQLite file that
 * outlives the process. Opening it twice against the same file is the restart
 * case. This stays a node entry point (`@oru/kernel/sqlite`) so a browser host
 * never pulls a filesystem driver into its bundle (ADR-0009).
 */
export const sqliteJournalLayer = (filename: string) =>
  SqlEventJournal.layer().pipe(Layer.provide(SqliteClient.layer({ filename })))
