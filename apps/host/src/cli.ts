import { readFileSync } from 'node:fs'
import { Data, Schema } from 'effect'
import { defaultHost, defaultPort } from './config.ts'

export { defaultHost, defaultPort }

export type Command = Data.TaggedEnum<{
  Help: {}
  Version: {}
  Serve: {
    readonly home?: string | undefined
    readonly hostname?: string | undefined
    readonly port?: number | undefined
    readonly journal?: string | undefined
  }
  PluginReload: {
    readonly home?: string | undefined
    readonly hostname?: string | undefined
    readonly port?: number | undefined
    readonly specifier: string
  }
  PluginDev: {
    readonly home?: string | undefined
    readonly hostname?: string | undefined
    readonly port?: number | undefined
    readonly path: string
    readonly debounce?: number | undefined
  }
  ConfigList: { readonly home?: string | undefined }
  ConfigSet: { readonly home?: string | undefined; readonly key: string; readonly value: string }
  ConfigUnset: { readonly home?: string | undefined; readonly key: string }
  Invalid: { readonly message: string }
}>

export const Command = Data.taggedEnum<Command>()

export const usage = `oru host

Runs the oru kernel and serves its RPC boundary.

Usage:
  oru-host [--home <dir>] [--host <address>] [--port <port>] [--journal <file>]
  oru-host [--home <dir>] [--host <address>] [--port <port>] plugin reload <id>
  oru-host [--home <dir>] [--host <address>] [--port <port>] plugin dev <path> [--debounce <ms>]
  oru-host [--home <dir>] config list
  oru-host [--home <dir>] config set <key> <value>
  oru-host [--home <dir>] config unset <key>
  oru-host --help
  oru-host --version

Options:
  --home <dir>      directory for config.json and data (default the ORU_HOME
                    environment variable, else ~/.oru)
  --host <address>  address to listen on (default ${defaultHost})
  --port <port>     port to listen on, 0 picks a free one (default ${defaultPort})
  --journal <file>  journal file to keep facts in, so a restart resumes
                    (default <home>/data/oru.db)
  --debounce <ms>   save-burst window for plugin dev (default 150)

Settings are flags, then config.json, then the environment, then these defaults.
host, port, journal, and the pi.* keys are startup-only: config set writes the
file and the next start reads it. The listen address stays loopback unless you
set host.
`

const PackageManifest = Schema.Struct({ version: Schema.String })

const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(PackageManifest))

/** The version the binary reports is the one the package is published as. */
export const packageVersion = (): string =>
  decodeManifest(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const needValue = (flag: string): Command => Command.Invalid({ message: `${flag} needs a value` })

interface FlagDraft {
  home?: string | undefined
  hostname?: string | undefined
  port?: number | undefined
  journal?: string | undefined
  debounce?: number | undefined
}

export const parseArgs = (argv: readonly string[]): Command => {
  let home: string | undefined
  let hostname: string | undefined
  let port: number | undefined
  let journal: string | undefined
  let debounce: number | undefined
  const positionals: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) continue
    if (arg === '--help' || arg === '-h') return Command.Help()
    if (arg === '--version' || arg === '-v') return Command.Version()
    if (
      arg === '--home' ||
      arg === '--host' ||
      arg === '--port' ||
      arg === '--journal' ||
      arg === '--debounce'
    ) {
      const value = argv[index + 1]
      if (value === undefined) return needValue(arg)
      index += 1
      if (arg === '--home') {
        home = value
        continue
      }
      if (arg === '--host') {
        hostname = value
        continue
      }
      if (arg === '--journal') {
        journal = value
        continue
      }
      if (arg === '--debounce') {
        const wanted = Number(value)
        if (!Number.isInteger(wanted) || wanted < 0 || wanted > 60_000) {
          return Command.Invalid({ message: `--debounce takes milliseconds, got ${value}` })
        }
        debounce = wanted
        continue
      }
      const wanted = Number(value)
      if (!Number.isInteger(wanted) || wanted < 0 || wanted > 65535) {
        return Command.Invalid({ message: `--port takes a port number, got ${value}` })
      }
      port = wanted
      continue
    }
    if (arg.startsWith('-')) {
      return Command.Invalid({ message: `unknown argument ${arg}` })
    }
    positionals.push(arg)
  }

  const flags: FlagDraft = {}
  if (home !== undefined) flags.home = home
  if (hostname !== undefined) flags.hostname = hostname
  if (port !== undefined) flags.port = port
  if (journal !== undefined) flags.journal = journal
  if (debounce !== undefined) flags.debounce = debounce

  if (positionals.length === 0) {
    return Command.Serve(flags)
  }
  if (positionals[0] === 'plugin') {
    return parsePlugin(positionals.slice(1), flags)
  }
  if (positionals[0] !== 'config') {
    return Command.Invalid({ message: `unknown argument ${positionals[0]}` })
  }
  const action = positionals[1]
  if (action === undefined || action === 'list') {
    if (positionals.length > 2) {
      return Command.Invalid({ message: 'config list takes no extra arguments' })
    }
    if (action === undefined) {
      return Command.Invalid({ message: 'config needs list, set, or unset' })
    }
    return Command.ConfigList(flags.home === undefined ? {} : { home: flags.home })
  }
  if (action === 'set') {
    const key = positionals[2]
    const value = positionals[3]
    if (key === undefined || value === undefined || positionals.length !== 4) {
      return Command.Invalid({ message: 'config set needs a key and a value' })
    }
    return flags.home === undefined
      ? Command.ConfigSet({ key, value })
      : Command.ConfigSet({ home: flags.home, key, value })
  }
  if (action === 'unset') {
    const key = positionals[2]
    if (key === undefined || positionals.length !== 3) {
      return Command.Invalid({ message: 'config unset needs a key' })
    }
    return flags.home === undefined
      ? Command.ConfigUnset({ key })
      : Command.ConfigUnset({ home: flags.home, key })
  }
  return Command.Invalid({ message: `unknown config action ${action}` })
}

export const parsePlugin = (rest: readonly string[], flags: FlagDraft): Command => {
  const target = { home: flags.home, hostname: flags.hostname, port: flags.port }
  const action = rest[0]
  if (action === 'reload') {
    const specifier = rest[1]
    if (specifier === undefined || rest.length !== 2) {
      return Command.Invalid({ message: 'plugin reload needs a plugin id' })
    }
    return Command.PluginReload({ ...target, specifier })
  }
  if (action === 'dev') {
    const path = rest[1]
    if (path === undefined || rest.length !== 2) {
      return Command.Invalid({ message: 'plugin dev needs a plugin path' })
    }
    return flags.debounce === undefined
      ? Command.PluginDev({ ...target, path })
      : Command.PluginDev({ ...target, path, debounce: flags.debounce })
  }
  if (action === undefined) {
    return Command.Invalid({ message: 'plugin needs reload or dev' })
  }
  return Command.Invalid({ message: `unknown plugin action ${action}` })
}
