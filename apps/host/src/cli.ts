import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Data, Schema } from 'effect'

export const defaultHost = '127.0.0.1'

/** The port a host takes by default: out of the registered range, easy to type. */
export const defaultPort = 7317

/**
 * Where the host keeps its journal.
 *
 * The environment override is what lets a test start the real binary without
 * writing to the developer's home. Which directory holds oru's data, and how
 * the choices precede each other, is issue #19's.
 */
export const defaultJournal = (): string =>
  process.env.ORU_JOURNAL ?? join(homedir(), '.oru', 'oru.db')

export type Command = Data.TaggedEnum<{
  Help: {}
  Version: {}
  Serve: { readonly hostname: string; readonly port: number; readonly journal: string }
  Invalid: { readonly message: string }
}>

export const Command = Data.taggedEnum<Command>()

export const usage = `oru host

Runs the oru kernel and serves its RPC boundary.

Usage:
  oru-host [--host <address>] [--port <port>] [--journal <file>]
  oru-host --help
  oru-host --version

Options:
  --host <address>  address to listen on (default ${defaultHost})
  --port <port>     port to listen on, 0 picks a free one (default ${defaultPort})
  --journal <file>  journal file to keep facts in, so a restart resumes
                    (default the ORU_JOURNAL environment variable, else
                    ${join('~', '.oru', 'oru.db')})
`

const PackageManifest = Schema.Struct({ version: Schema.String })

const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(PackageManifest))

/** The version the binary reports is the one the package is published as. */
export const packageVersion = (): string =>
  decodeManifest(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const needValue = (flag: string): Command => Command.Invalid({ message: `${flag} needs a value` })

export const parseArgs = (argv: readonly string[]): Command => {
  let hostname = defaultHost
  let port = defaultPort
  let journal = defaultJournal()

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) continue
    if (arg === '--help' || arg === '-h') return Command.Help()
    if (arg === '--version' || arg === '-v') return Command.Version()
    if (arg !== '--host' && arg !== '--port' && arg !== '--journal') {
      return Command.Invalid({ message: `unknown argument ${arg}` })
    }
    const value = argv[index + 1]
    if (value === undefined) return needValue(arg)
    index += 1
    if (arg === '--host') {
      hostname = value
      continue
    }
    if (arg === '--journal') {
      journal = value
      continue
    }
    const wanted = Number(value)
    if (!Number.isInteger(wanted) || wanted < 0 || wanted > 65535) {
      return Command.Invalid({ message: `--port takes a port number, got ${value}` })
    }
    port = wanted
  }

  return Command.Serve({ hostname, port, journal })
}
