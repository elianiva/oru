import { Effect } from 'effect'
import { SessionActivated, SessionLog, unsignedTree } from '../../src/index.ts'
import { sessionLogLayerSqlite } from '../../src/sqlite.ts'

const file = process.argv[2]
if (file === undefined || file === '') {
  console.error('usage: write-sqlite-event.ts <sqlite-path>')
  process.exit(1)
}

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const log = yield* SessionLog
      yield* log.write(
        SessionActivated.make({
          ...unsignedTree,
          id: 'from-writer',
          plugin: 'logging',
          scope: 'host',
        }),
      )
    }).pipe(Effect.provide(sessionLogLayerSqlite(file))),
  ),
)
