#!/usr/bin/env node
import { Effect, Match, Schema, type Scope } from 'effect'
import { ServeError } from 'effect/unstable/http/HttpServerError'
import type { BootError } from '@oru/kernel'
import type { JournalOpenError } from '@oru/kernel/sqlite'
import type { PluginId } from '@oru/kernel'
import { PluginReloadClient, reloadFor } from '@oru/rpc'
import { packageVersion, parseArgs, usage } from './cli.ts'
import { corePlugins } from './plugins.ts'
import { loadExternalPlugins, readPluginList } from './plugin-sources.ts'
import { describeReload, startDevWatch } from './dev-watch.ts'
import { serveHost } from './server.ts'

import {
  ConfigError,
  ensureLayout,
  isWritableKey,
  listLines,
  loadFileConfig,
  openSettings,
  personalDirOf,
  piEnvOf,
  setFileKey,
  unsetFileKey,
  writeFileConfig,
  type Settings,
} from './config.ts'

/** Drop `undefined` so the value survives the trip across the host boundary. */
const stringEnvOf = (env: NodeJS.ProcessEnv) => {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

const registryDefaultsOf = (settings: Settings) => {
  const out: Record<string, string> = {}
  if (settings.defaultHarness.value !== undefined) out.harness = settings.defaultHarness.value
  if (settings.defaultModel.value !== undefined) out.model = settings.defaultModel.value
  return out
}

const workspaceDefaultsOf = (settings: Settings) => {
  const out: Record<string, string> = {}
  if (settings.workspaceProvider.value !== undefined) {
    out.provider = settings.workspaceProvider.value
  }
  return out
}

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
      PluginReload: (command) =>
        Effect.gen(function* () {
          const settings = yield* syncConfig(() => {
            const inner = openSettings(
              { home: command.home, hostname: command.hostname, port: command.port },
              process.env,
            )
            ensureLayout(inner.home.value)
            return inner
          })
          const url = `http://${settings.hostname.value}:${settings.port.value}`
          const program = Effect.gen(function* () {
            const client = yield* PluginReloadClient
            return yield* client.reload(command.specifier)
          }).pipe(Effect.provide(reloadFor(url)))
          return yield* Effect.scoped(program).pipe(
            Effect.flatMap((result) =>
              write(`${describeReload(result)}\n`, process.stdout).pipe(Effect.as(0)),
            ),
            Effect.catchTags({
              UnknownPlugin: (error) =>
                write(
                  `error: unknown plugin "${error.specifier}" (this host serves: ${error.known.join(', ') || 'nothing'})\n`,
                  process.stderr,
                ).pipe(Effect.as(2)),
              ReloadFailed: (error) =>
                write(
                  `error: reload ${error.specifier} failed: ${error.reason}\n`,
                  process.stderr,
                ).pipe(Effect.as(1)),
              HostUnreachable: (error) =>
                write(`error: host at ${url} unreachable: ${error.reason}\n`, process.stderr).pipe(
                  Effect.as(1),
                ),
            }),
          )
        }),
      PluginDev: (command) =>
        Effect.gen(function* () {
          const settings = yield* syncConfig(() => {
            const inner = openSettings(
              { home: command.home, hostname: command.hostname, port: command.port },
              process.env,
            )
            ensureLayout(inner.home.value)
            return inner
          })
          const url = `http://${settings.hostname.value}:${settings.port.value}`
          let stop: (() => void) | undefined
          try {
            stop = startDevWatch(command.path, {
              url,
              debounceMs: command.debounce,
              log: (line) => process.stdout.write(`${line}\n`),
            })
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause)
            yield* write(`error: ${message}\n`, process.stderr)
            return 2
          }
          yield* askedToStop
          yield* Effect.sync(stop)
          return 0
        }),
      Serve: (command) =>
        Effect.gen(function* () {
          const settings = yield* syncConfig(() => {
            const settings = openSettings(command, process.env)
            ensureLayout(settings.home.value)
            return settings
          })
          const sources = readPluginList()
          const external = yield* loadExternalPlugins(sources)
          // Configuration reaches plugins as data on their defs: the
          // resolved settings are decoded against each plugin's `Config`
          // when it activates, and every bridge reads the value it is
          // handed instead of the process environment.
          const configs = new Map<PluginId, unknown>([
            ['oru/harness-registry', registryDefaultsOf(settings)],
            ['oru/workspace-registry', workspaceDefaultsOf(settings)],
            ['oru/harness-pi', { env: stringEnvOf(piEnvOf(process.env, settings)) }],
            ['oru/harness-claude-code', { env: stringEnvOf(process.env) }],
            ['oru/harness-opencode', { env: stringEnvOf(process.env) }],
          ])
          const running = yield* serveHost({
            plugins: [...corePlugins, ...external],
            configs,
            hostname: settings.hostname.value,
            port: settings.port.value,
            journal: settings.journal.value,
            personalCwd: personalDirOf(settings.home.value),
            ui: {
              sources,
              overrides: {
                composer: settings.uiSlotsComposer.value,
                conversation: settings.uiSlotsConversation.value,
              },
            },
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
