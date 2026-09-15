#!/usr/bin/env node
import { Effect, type Scope } from 'effect'
import { ServeError } from 'effect/unstable/http/HttpServerError'
import type { SqlError } from 'effect/unstable/sql/SqlError'
import type { BootError } from '@oru/kernel'
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

/**
 * A `ServeError` carries the reason it wrapped and nothing else, so its own
 * message is empty, and a `SqlError` says something only when the driver did.
 * Everything else already says what went wrong.
 */
const describeFailure = (error: BootError | ServeError | SqlError): string => {
  if (error._tag === 'ServeError') return String(error.cause)
  if (error._tag === 'SqlError') return error.message ?? String(error.cause)
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

    try {
      if (command._tag === 'ConfigList') {
        const flags = command.home === undefined ? {} : { home: command.home }
        const settings = openSettings(flags, process.env)
        ensureLayout(settings.home.value)
        yield* write(`${listLines(settings).join('\n')}\n`, process.stdout)
        return 0
      }
      if (command._tag === 'ConfigSet') {
        if (!isWritableKey(command.key)) {
          yield* write(`unknown setting ${command.key}\n\n${usage}`, process.stderr)
          return 2
        }
        const flags = command.home === undefined ? {} : { home: command.home }
        const settings = openSettings(flags, process.env)
        writeFileConfig(
          settings.home.value,
          setFileKey(loadFileConfig(settings.home.value), command.key, command.value),
        )
        yield* write(
          `set ${command.key}; it is startup-only, so the next start reads it\n`,
          process.stdout,
        )
        return 0
      }
      if (command._tag === 'ConfigUnset') {
        if (!isWritableKey(command.key)) {
          yield* write(`unknown setting ${command.key}\n\n${usage}`, process.stderr)
          return 2
        }
        const flags = command.home === undefined ? {} : { home: command.home }
        const settings = openSettings(flags, process.env)
        writeFileConfig(
          settings.home.value,
          unsetFileKey(loadFileConfig(settings.home.value), command.key),
        )
        yield* write(
          `unset ${command.key}; it is startup-only, so the next start reads it\n`,
          process.stdout,
        )
        return 0
      }

      const settings = openSettings(command, process.env)
      ensureLayout(settings.home.value)
      const running = yield* serveHost({
        plugins: hostPluginsWith(piEnvOf(process.env, settings)),
        hostname: settings.hostname.value,
        port: settings.port.value,
        journal: settings.journal.value,
      })
      yield* write(`oru host listening on ${running.url}\n`, process.stdout)
      yield* askedToStop
      return 0
    } catch (cause) {
      if (cause instanceof ConfigError) {
        yield* write(`oru host failed: ${cause.message}\n`, process.stderr)
        return 2
      }
      throw cause
    }
  }).pipe(
    Effect.catch((error) =>
      write(`oru host failed: ${describeFailure(error)}\n`, process.stderr).pipe(Effect.as(1)),
    ),
  )

process.exitCode = await Effect.runPromise(Effect.scoped(run(process.argv.slice(2))))
