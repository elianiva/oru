#!/usr/bin/env node
import { Effect, Match, Schema, type Scope } from 'effect'
import { ServeError } from 'effect/unstable/http/HttpServerError'
import type { BootError } from '@oru/kernel'
import type { JournalOpenError } from '@oru/kernel/sqlite'
import { packageVersion, parseArgs, usage } from './cli.ts'
import {
  ConfigError,
  ensureLayout,
  isWritableKey,
  listLines,
  loadFileConfig,
  openSettings,
  piEnvOf,
  setFileKey,
  unsetFileKey,
  writeFileConfig,
} from './config.ts'
import { hostPluginsWith } from './plugins.ts'
import { serveHost } from './server.ts'

const write = (line: string, stream: NodeJS.WriteStream) =>
  Effect.sync(() => {
    stream.write(line)
  })

const describeFailure = (error: BootError | ServeError | JournalOpenError): string =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      ServeError: (error) => String(error.cause),
      SqlError: (error) => error.message ?? String(error.cause),
      SchemaTooNew: (error) =>
        `journal ${error.path} was written by a newer schema (${error.unknown.join(', ')})`,
      SchemaDiverged: (error) =>
        `journal ${error.path} has a migration history this build does not apply (${error.applied.join(', ')})`,
      DuplicateProvider: (error) => error.message,
      GraphCycle: (error) => error.message,
    }),
  )

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

const homeFlags = (home: string | undefined) => (home === undefined ? {} : { home })

const syncConfig = <A>(run: () => A): Effect.Effect<A, ConfigError> =>
  Effect.try({
    try: run,
    catch: (cause) => {
      if (Schema.is(ConfigError)(cause)) return cause
      throw cause
    },
  })

const run = (argv: readonly string[]): Effect.Effect<number, never, Scope.Scope> =>
  Match.value(parseArgs(argv)).pipe(
    Match.tagsExhaustive({
      Invalid: (command) =>
        write(`${command.message}\n\n${usage}`, process.stderr).pipe(Effect.as(2)),
      Help: () => write(usage, process.stdout).pipe(Effect.as(0)),
      Version: () => write(`${packageVersion()}\n`, process.stdout).pipe(Effect.as(0)),
      ConfigList: (command) =>
        Effect.gen(function* () {
          const settings = yield* syncConfig(() => {
            const settings = openSettings(homeFlags(command.home), process.env)
            ensureLayout(settings.home.value)
            return settings
          })
          yield* write(`${listLines(settings).join('\n')}\n`, process.stdout)
          return 0
        }),
      ConfigSet: (command) =>
        Effect.gen(function* () {
          if (!isWritableKey(command.key)) {
            yield* write(`unknown setting ${command.key}\n\n${usage}`, process.stderr)
            return 2
          }
          const key = command.key
          yield* syncConfig(() => {
            const settings = openSettings(homeFlags(command.home), process.env)
            writeFileConfig(
              settings.home.value,
              setFileKey(loadFileConfig(settings.home.value), key, command.value),
            )
          })
          yield* write(
            `set ${key}; it is startup-only, so the next start reads it\n`,
            process.stdout,
          )
          return 0
        }),
      ConfigUnset: (command) =>
        Effect.gen(function* () {
          if (!isWritableKey(command.key)) {
            yield* write(`unknown setting ${command.key}\n\n${usage}`, process.stderr)
            return 2
          }
          const key = command.key
          yield* syncConfig(() => {
            const settings = openSettings(homeFlags(command.home), process.env)
            writeFileConfig(
              settings.home.value,
              unsetFileKey(loadFileConfig(settings.home.value), key),
            )
          })
          yield* write(
            `unset ${key}; it is startup-only, so the next start reads it\n`,
            process.stdout,
          )
          return 0
        }),
      Serve: (command) =>
        Effect.gen(function* () {
          const settings = yield* syncConfig(() => {
            const settings = openSettings(command, process.env)
            ensureLayout(settings.home.value)
            return settings
          })
          const running = yield* serveHost({
            plugins: hostPluginsWith(piEnvOf(process.env, settings)),
            hostname: settings.hostname.value,
            port: settings.port.value,
            journal: settings.journal.value,
          })
          yield* write(`oru host listening on ${running.url}\n`, process.stdout)
          yield* askedToStop
          return 0
        }),
    }),
    Effect.catchTag('ConfigError', (error) =>
      write(`oru host failed: ${error.message}\n`, process.stderr).pipe(Effect.as(2)),
    ),
    Effect.catch((error) =>
      write(`oru host failed: ${describeFailure(error)}\n`, process.stderr).pipe(Effect.as(1)),
    ),
  )

process.exitCode = await Effect.runPromise(Effect.scoped(run(process.argv.slice(2))))
