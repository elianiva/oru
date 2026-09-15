#!/usr/bin/env node
import { Effect, type Scope } from 'effect'
import { ServeError } from 'effect/unstable/http/HttpServerError'
import type { BootError } from '@oru/kernel'
import type { JournalOpenError } from '@oru/kernel/sqlite'
import { packageVersion, parseArgs, usage } from './cli.ts'
import { hostPlugins } from './plugins.ts'
import { serveHost } from './server.ts'

const write = (line: string, stream: NodeJS.WriteStream) =>
  Effect.sync(() => {
    stream.write(line)
  })

/**
 * A `ServeError` carries the reason it wrapped and nothing else, so its own
 * message is empty, and a `SqlError` says something only when the driver did.
 * Everything else already says what went wrong.
 */
const describeFailure = (error: BootError | ServeError | JournalOpenError): string => {
  if (error._tag === 'ServeError') return String(error.cause)
  if (error._tag === 'SqlError') return error.message ?? String(error.cause)
  if (error._tag === 'SchemaTooNew') {
    return `journal ${error.path} was written by a newer schema (${error.unknown.join(', ')})`
  }
  if (error._tag === 'SchemaDiverged') {
    return `journal ${error.path} has a migration history this build does not apply (${error.applied.join(', ')})`
  }
  return error.message
}

/**
 * Resolve when the process is asked to stop, so the scope closes in order: the
 * kernel deactivates the pi bridge, and the bridge stops every pi child it
 * spawned (ADR-0007). Without this, a Ctrl-C would leave them orphaned.
 */
const askedToStop = Effect.callback<void>((resume) => {
  const stop = () => {
    resume(Effect.void)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return Effect.sync(() => {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  })
})

const run = (argv: readonly string[]): Effect.Effect<number, never, Scope.Scope> =>
  Effect.gen(function* () {
    const command = parseArgs(argv)
    if (command._tag === 'Invalid') {
      yield* write(`${command.message}\n\n${usage}`, process.stderr)
      return 2
    }
    if (command._tag === 'Help') {
      yield* write(usage, process.stdout)
      return 0
    }
    if (command._tag === 'Version') {
      yield* write(`${packageVersion()}\n`, process.stdout)
      return 0
    }

    const running = yield* serveHost({
      plugins: hostPlugins,
      hostname: command.hostname,
      port: command.port,
      journal: command.journal,
    })
    yield* write(`oru host listening on ${running.url}\n`, process.stdout)
    yield* askedToStop
    return 0
  }).pipe(
    Effect.catch((error) =>
      write(`oru host failed: ${describeFailure(error)}\n`, process.stderr).pipe(Effect.as(1)),
    ),
  )

process.exitCode = await Effect.runPromise(Effect.scoped(run(process.argv.slice(2))))
