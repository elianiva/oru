import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { Effect, type Scope } from 'effect'
import { SessionLog } from '../src/index.ts'
import { SchemaTooNew, sessionLogLayerSqlite } from '../src/sqlite.ts'
import { journalTable } from '../src/sqlite-migrate.ts'

const runSqlite = <A, E>(file: string, effect: Effect.Effect<A, E, SessionLog | Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(sessionLogLayerSqlite(file)))))

const writer = fileURLToPath(new URL('./fixtures/write-sqlite-event.ts', import.meta.url))

describe('sessionLogLayerSqlite', () => {
  it('reads an event written by a second process against the same file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oru-journal-'))
    const file = join(dir, 'oru.db')
    const child = spawnSync(process.execPath, [writer, file], { encoding: 'utf8' })
    expect(child.status, child.stderr).toBe(0)
    const tags = await runSqlite(
      file,
      Effect.gen(function* () {
        const log = yield* SessionLog
        const entries = yield* log.entries
        return entries.map((event) => event._tag)
      }),
    )
    expect(tags).toEqual(['plugin/activated'])
  })

  it('refuses a newer schema and leaves the file bytes unchanged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oru-journal-ahead-'))
    const file = join(dir, 'oru.db')
    const db = new DatabaseSync(file)
    db.exec(`
      CREATE TABLE ${journalTable} (
        tag TEXT PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `)
    db.exec(`INSERT INTO ${journalTable} (tag, applied_at) VALUES ('9999_future', 0)`)
    db.close()
    const before = readFileSync(file)
    const namesBefore = readdirSync(dir)
    const error = await runSqlite(file, Effect.void).then(
      () => undefined,
      (cause: unknown) => cause,
    )
    expect(error).toBeInstanceOf(SchemaTooNew)
    expect(error).toMatchObject({ unknown: ['9999_future'], path: file })
    expect(readFileSync(file).equals(before)).toBe(true)
    expect(readdirSync(dir)).toEqual(namesBefore)
  })
})
