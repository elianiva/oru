import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Clock, Effect, Match, Schema } from 'effect'
import { SqlClient } from 'effect/unstable/sql/SqlClient'
import type { SqlError } from 'effect/unstable/sql/SqlError'

export const journalTable = 'oru_schema_migrations'

export const Migration = Schema.Struct({
  tag: Schema.NonEmptyString,
  sql: Schema.String,
})
export type Migration = typeof Migration.Type

export const migrations: readonly Migration[] = [
  Migration.make({
    tag: '0001_init',
    sql: 'SELECT 1',
  }),
]

export type OpenPlan =
  | { readonly kind: 'ready' }
  | { readonly kind: 'pending'; readonly rest: readonly Migration[] }
  | { readonly kind: 'ahead'; readonly unknown: readonly string[] }
  | { readonly kind: 'diverged'; readonly applied: readonly string[] }

export class SchemaTooNew extends Schema.TaggedError<SchemaTooNew>()('SchemaTooNew', {
  path: Schema.String,
  unknown: Schema.Array(Schema.String),
}) {}

export class SchemaDiverged extends Schema.TaggedError<SchemaDiverged>()('SchemaDiverged', {
  path: Schema.String,
  applied: Schema.Array(Schema.String),
}) {}

const AppliedRows = Schema.Array(Schema.Struct({ tag: Schema.String }))

export const plan = (applied: readonly string[], chain: readonly Migration[]): OpenPlan => {
  const tags = chain.map((migration) => migration.tag)
  const unknown = applied.filter((tag) => !tags.includes(tag))
  if (unknown.length > 0) return { kind: 'ahead', unknown }
  for (let index = 0; index < applied.length; index++) {
    if (applied[index] !== tags[index]) return { kind: 'diverged', applied }
  }
  if (applied.length === tags.length) return { kind: 'ready' }
  return { kind: 'pending', rest: chain.slice(applied.length) }
}

const readApplied = (filename: string): readonly string[] => {
  if (!existsSync(filename)) return []
  const db = new DatabaseSync(filename, { readOnly: true })
  try {
    const tables = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })))(
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .all(journalTable),
    )
    if (tables.length === 0) return []
    const rows = Schema.decodeUnknownSync(AppliedRows)(
      db.prepare(`SELECT tag FROM ${journalTable} ORDER BY tag`).all(),
    )
    return rows.map((row) => row.tag)
  } finally {
    db.close()
  }
}

export const refuseIfAhead = (
  filename: string,
): Effect.Effect<void, SchemaTooNew | SchemaDiverged> =>
  Match.value(plan(readApplied(filename), migrations)).pipe(
    Match.when({ kind: 'ready' }, () => Effect.void),
    Match.when({ kind: 'pending' }, () => Effect.void),
    Match.when({ kind: 'ahead' }, (ahead) =>
      Effect.fail(new SchemaTooNew({ path: filename, unknown: ahead.unknown })),
    ),
    Match.when({ kind: 'diverged' }, (diverged) =>
      Effect.fail(new SchemaDiverged({ path: filename, applied: diverged.applied })),
    ),
    Match.exhaustive,
  )

const ensureJournal = (sql: SqlClient) =>
  sql`
    CREATE TABLE IF NOT EXISTS ${sql(journalTable)} (
      tag TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    )`

const appliedFromClient = (sql: SqlClient) =>
  sql<{ tag: string }>`SELECT tag FROM ${sql(journalTable)} ORDER BY tag`.pipe(
    Effect.map((rows) => rows.map((row) => row.tag)),
  )

const runPending = (sql: SqlClient, rest: readonly Migration[]) =>
  Effect.gen(function* () {
    const appliedAt = yield* Clock.currentTimeMillis
    for (const migration of rest) {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql.unsafe(migration.sql)
          yield* sql`INSERT INTO ${sql(journalTable)} ${sql.insert({ tag: migration.tag, applied_at: appliedAt })}`
        }),
      )
    }
  })

export const applyPending = (
  sql: SqlClient,
  filename: string,
): Effect.Effect<void, SchemaTooNew | SchemaDiverged | SqlError> =>
  Effect.gen(function* () {
    const raw = sql.withoutTransforms()
    yield* ensureJournal(raw)
    const applied = yield* appliedFromClient(raw)
    yield* Match.value(plan(applied, migrations)).pipe(
      Match.when({ kind: 'ready' }, () => Effect.void),
      Match.when({ kind: 'pending' }, (pending) => runPending(raw, pending.rest)),
      Match.when({ kind: 'ahead' }, (ahead) =>
        Effect.fail(new SchemaTooNew({ path: filename, unknown: ahead.unknown })),
      ),
      Match.when({ kind: 'diverged' }, (diverged) =>
        Effect.fail(new SchemaDiverged({ path: filename, applied: diverged.applied })),
      ),
      Match.exhaustive,
    )
  })
