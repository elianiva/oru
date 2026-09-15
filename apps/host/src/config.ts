import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Option, Predicate, Schema } from 'effect'

export const defaultHost = '127.0.0.1'

/** The port a host takes by default: out of the registered range, easy to type. */
export const defaultPort = 7317

export type Source = 'flag' | 'file' | 'env' | 'default'

export type Lifetime = 'startup' | 'live'

export interface Chosen<T> {
  readonly value: T
  readonly source: Source
}

interface FilePiDraft {
  home?: string | undefined
  sessionDir?: string | undefined
  command?: string | undefined
  args?: readonly string[] | undefined
  skills?: readonly string[] | undefined
  noBuiltinTools?: boolean | undefined
}

interface FileDraft {
  host?: string | undefined
  port?: number | undefined
  journal?: string | undefined
  pi?: FilePi | undefined
}

export interface ServeDraft {
  home?: string | undefined
  hostname?: string | undefined
  port?: number | undefined
  journal?: string | undefined
}

export interface FilePi {
  readonly home?: string | undefined
  readonly sessionDir?: string | undefined
  readonly command?: string | undefined
  readonly args?: readonly string[] | undefined
  readonly skills?: readonly string[] | undefined
  readonly noBuiltinTools?: boolean | undefined
}

export interface FileConfig {
  readonly host?: string | undefined
  readonly port?: number | undefined
  readonly journal?: string | undefined
  readonly pi?: FilePi | undefined
}

export interface ServeFlags {
  readonly home?: string | undefined
  readonly hostname?: string | undefined
  readonly port?: number | undefined
  readonly journal?: string | undefined
}

export interface CatalogKey {
  readonly name: string
  readonly env?: string
  readonly lifetime: Lifetime
}

/**
 * Every setting the host admits. A key that is not here is not configuration,
 * including `ORU_PI_E2E_MODEL` (tests) and `ORU_PI_TOOLS_FILE` (scratch).
 */
export const catalog = [
  { name: 'home', env: 'ORU_HOME', lifetime: 'startup' },
  { name: 'host', env: 'ORU_HOST', lifetime: 'startup' },
  { name: 'port', env: 'ORU_PORT', lifetime: 'startup' },
  { name: 'journal', env: 'ORU_JOURNAL', lifetime: 'startup' },
  { name: 'pi.home', env: 'ORU_PI_HOME', lifetime: 'startup' },
  { name: 'pi.sessionDir', env: 'ORU_PI_SESSION_DIR', lifetime: 'startup' },
  { name: 'pi.command', env: 'ORU_PI_COMMAND', lifetime: 'startup' },
  { name: 'pi.args', env: 'ORU_PI_ARGS', lifetime: 'startup' },
  { name: 'pi.skills', env: 'ORU_PI_SKILLS', lifetime: 'startup' },
  { name: 'pi.noBuiltinTools', env: 'ORU_PI_NO_BUILTIN_TOOLS', lifetime: 'startup' },
] as const satisfies readonly CatalogKey[]

export type ConfigKeyName = (typeof catalog)[number]['name']

const writableKeys = [
  'host',
  'port',
  'journal',
  'pi.home',
  'pi.sessionDir',
  'pi.command',
  'pi.args',
  'pi.skills',
  'pi.noBuiltinTools',
] as const

export type WritableKey = (typeof writableKeys)[number]

export const isWritableKey = (key: string): key is WritableKey =>
  writableKeys.some((known) => known === key)

export const configPath = (home: string): string => join(home, 'config.json')

export const dataDirOf = (home: string): string => join(home, 'data')

export const defaultJournalOf = (home: string): string => join(dataDirOf(home), 'oru.db')

export const defaultPiHomeOf = (home: string): string => join(dataDirOf(home), 'pi')

export const defaultPiSessionDirOf = (piHome: string): string => join(piHome, 'sessions')

export const defaultHome = (osHome: string = homedir()): string => join(osHome, '.oru')

const PiFile = Schema.Struct({
  home: Schema.optional(Schema.String),
  sessionDir: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  skills: Schema.optional(Schema.Array(Schema.String)),
  noBuiltinTools: Schema.optional(Schema.Boolean),
})

const FileDocument = Schema.Struct({
  host: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Number),
  journal: Schema.optional(Schema.String),
  pi: Schema.optional(PiFile),
})

const decodeFile = Schema.decodeUnknownSync(FileDocument)
const decodeJsonValue = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const decodeStringList = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.String)),
)

export class ConfigError extends Error {
  override readonly name = 'ConfigError'
}

const fail = (message: string): never => {
  throw new ConfigError(message)
}

const rootKeySet = new Set(['host', 'port', 'journal', 'pi'])
const piKeySet = new Set(['home', 'sessionDir', 'command', 'args', 'skills', 'noBuiltinTools'])

const rejectUnknownKeys = (
  keys: readonly string[],
  allowed: ReadonlySet<string>,
  where: string,
) => {
  for (const key of keys) {
    if (!allowed.has(key)) return fail(`${where} has unknown key ${key}`)
  }
}

export const parseFileConfig = (text: string): FileConfig => {
  const json = decodeJsonValue(text)
  if (Option.isNone(json)) return fail('config.json is not JSON')
  const value = json.value
  if (!Predicate.isObject(value)) return fail('config.json must be an object')
  rejectUnknownKeys(Object.keys(value), rootKeySet, 'config.json')
  if (Predicate.hasProperty(value, 'pi') && value.pi !== undefined) {
    if (!Predicate.isObject(value.pi)) return fail('config.json pi must be an object')
    rejectUnknownKeys(Object.keys(value.pi), piKeySet, 'config.json pi')
  }
  try {
    return compactFile(decodeFile(value))
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : 'config.json is invalid')
  }
}

export const loadFileConfig = (home: string): FileConfig => {
  const path = configPath(home)
  if (!existsSync(path)) return {}
  return parseFileConfig(readFileSync(path, 'utf8'))
}

const pick = <T>(
  flag: T | undefined,
  file: T | undefined,
  env: T | undefined,
  fallback: T,
): Chosen<T> => {
  if (flag !== undefined) return { value: flag, source: 'flag' }
  if (file !== undefined) return { value: file, source: 'file' }
  if (env !== undefined) return { value: env, source: 'env' }
  return { value: fallback, source: 'default' }
}

const envString = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name]
  if (value === undefined || value === '') return undefined
  return value
}

const envPort = (env: NodeJS.ProcessEnv): number | undefined => {
  const raw = envString(env, 'ORU_PORT')
  if (raw === undefined) return undefined
  const wanted = Number(raw)
  if (!Number.isInteger(wanted) || wanted < 0 || wanted > 65535) {
    return fail(`ORU_PORT takes a port number, got ${raw}`)
  }
  return wanted
}

const envFlag = (env: NodeJS.ProcessEnv, name: string): boolean | undefined => {
  const raw = envString(env, name)
  if (raw === undefined) return undefined
  if (raw === '1' || raw === 'true') return true
  if (raw === '0' || raw === 'false') return false
  return fail(`${name} takes 1, 0, true, or false, got ${raw}`)
}

const envJsonStrings = (env: NodeJS.ProcessEnv, name: string): readonly string[] | undefined => {
  const raw = envString(env, name)
  if (raw === undefined) return undefined
  const parsed = decodeStringList(raw)
  if (Option.isNone(parsed)) return fail(`${name} must be a JSON array of strings`)
  return parsed.value
}

export interface Settings {
  readonly home: Chosen<string>
  readonly hostname: Chosen<string>
  readonly port: Chosen<number>
  readonly journal: Chosen<string>
  readonly dataDir: string
  readonly piHome: Chosen<string>
  readonly piSessionDir: Chosen<string>
  readonly piCommand: Chosen<string | undefined>
  readonly piArgs: Chosen<readonly string[] | undefined>
  readonly piSkills: Chosen<readonly string[] | undefined>
  readonly piNoBuiltinTools: Chosen<boolean>
}

export const resolveHome = (
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
  osHome: string,
): Chosen<string> => pick(flag, undefined, envString(env, 'ORU_HOME'), defaultHome(osHome))

export const resolveSettings = (
  flags: ServeFlags,
  env: NodeJS.ProcessEnv,
  file: FileConfig,
  osHome: string,
): Settings => {
  const home = resolveHome(flags.home, env, osHome)
  const dataDir = dataDirOf(home.value)
  const hostname = pick(flags.hostname, file.host, envString(env, 'ORU_HOST'), defaultHost)
  const port = pick(flags.port, file.port, envPort(env), defaultPort)
  const journal = pick(
    flags.journal,
    file.journal,
    envString(env, 'ORU_JOURNAL'),
    defaultJournalOf(home.value),
  )
  const piHome = pick(
    undefined,
    file.pi?.home,
    envString(env, 'ORU_PI_HOME'),
    defaultPiHomeOf(home.value),
  )
  const piSessionDir = pick(
    undefined,
    file.pi?.sessionDir,
    envString(env, 'ORU_PI_SESSION_DIR'),
    defaultPiSessionDirOf(piHome.value),
  )
  const piCommand = pick(undefined, file.pi?.command, envString(env, 'ORU_PI_COMMAND'), undefined)
  const piArgs = pick(undefined, file.pi?.args, envJsonStrings(env, 'ORU_PI_ARGS'), undefined)
  const piSkills = pick(undefined, file.pi?.skills, envJsonStrings(env, 'ORU_PI_SKILLS'), undefined)
  const piNoBuiltinTools = pick(
    undefined,
    file.pi?.noBuiltinTools,
    envFlag(env, 'ORU_PI_NO_BUILTIN_TOOLS'),
    false,
  )
  return {
    home,
    hostname,
    port,
    journal,
    dataDir,
    piHome,
    piSessionDir,
    piCommand,
    piArgs,
    piSkills,
    piNoBuiltinTools,
  }
}

const assign = (env: NodeJS.ProcessEnv, name: string, value: string | undefined) => {
  if (value === undefined || value === '') {
    delete env[name]
    return
  }
  env[name] = value
}

/** The env bag the pi bridge reads. Winning values overwrite ambient ones. */
export const piEnvOf = (base: NodeJS.ProcessEnv, settings: Settings): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...base }
  assign(env, 'ORU_HOME', settings.home.value)
  assign(env, 'ORU_HOST', settings.hostname.value)
  assign(env, 'ORU_PORT', String(settings.port.value))
  assign(env, 'ORU_JOURNAL', settings.journal.value)
  assign(env, 'ORU_PI_HOME', settings.piHome.value)
  assign(env, 'ORU_PI_SESSION_DIR', settings.piSessionDir.value)
  assign(env, 'ORU_PI_COMMAND', settings.piCommand.value)
  assign(
    env,
    'ORU_PI_ARGS',
    settings.piArgs.value === undefined ? undefined : JSON.stringify(settings.piArgs.value),
  )
  assign(
    env,
    'ORU_PI_SKILLS',
    settings.piSkills.value === undefined ? undefined : JSON.stringify(settings.piSkills.value),
  )
  assign(env, 'ORU_PI_NO_BUILTIN_TOOLS', settings.piNoBuiltinTools.value ? '1' : undefined)
  return env
}

export const ensureLayout = (home: string): void => {
  mkdirSync(home, { recursive: true, mode: 0o700 })
  mkdirSync(dataDirOf(home), { recursive: true, mode: 0o700 })
  mkdirSync(defaultPiSessionDirOf(defaultPiHomeOf(home)), { recursive: true, mode: 0o700 })
  const path = configPath(home)
  if (!existsSync(path)) writeFileSync(path, '{}\n', { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
}

const compactPi = (pi: FilePi): FilePi | undefined => {
  const next: FilePiDraft = {}
  if (pi.home !== undefined) next.home = pi.home
  if (pi.sessionDir !== undefined) next.sessionDir = pi.sessionDir
  if (pi.command !== undefined) next.command = pi.command
  if (pi.args !== undefined) next.args = pi.args
  if (pi.skills !== undefined) next.skills = pi.skills
  if (pi.noBuiltinTools !== undefined) next.noBuiltinTools = pi.noBuiltinTools
  if (Object.keys(next).length === 0) return undefined
  return next
}

const compactFile = (file: FileConfig): FileConfig => {
  const next: FileDraft = {}
  if (file.host !== undefined) next.host = file.host
  if (file.port !== undefined) next.port = file.port
  if (file.journal !== undefined) next.journal = file.journal
  if (file.pi !== undefined) {
    const pi = compactPi(file.pi)
    if (pi !== undefined) next.pi = pi
  }
  return next
}

export const writeFileConfig = (home: string, file: FileConfig): void => {
  ensureLayout(home)
  const path = configPath(home)
  writeFileSync(path, `${JSON.stringify(compactFile(file), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  chmodSync(path, 0o600)
}

const parsePortValue = (value: string): number => {
  const wanted = Number(value)
  if (!Number.isInteger(wanted) || wanted < 0 || wanted > 65535) {
    return fail(`port takes a port number, got ${value}`)
  }
  return wanted
}

const parseBoolValue = (value: string): boolean => {
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return fail(`pi.noBuiltinTools takes 1, 0, true, or false, got ${value}`)
}

const parseStringArray = (value: string): readonly string[] => {
  const parsed = decodeStringList(value)
  if (Option.isNone(parsed)) return fail('that key takes a JSON array of strings')
  return parsed.value
}

const withPi = (file: FileConfig, patch: FilePi): FileConfig => {
  const current = file.pi ?? {}
  const pi: FilePiDraft = {}
  const home = patch.home ?? current.home
  const sessionDir = patch.sessionDir ?? current.sessionDir
  const command = patch.command ?? current.command
  const args = patch.args ?? current.args
  const skills = patch.skills ?? current.skills
  const noBuiltinTools = patch.noBuiltinTools ?? current.noBuiltinTools
  if (home !== undefined) pi.home = home
  if (sessionDir !== undefined) pi.sessionDir = sessionDir
  if (command !== undefined) pi.command = command
  if (args !== undefined) pi.args = args
  if (skills !== undefined) pi.skills = skills
  if (noBuiltinTools !== undefined) pi.noBuiltinTools = noBuiltinTools
  return compactFile({
    host: file.host,
    port: file.port,
    journal: file.journal,
    pi,
  })
}

export const setFileKey = (file: FileConfig, key: WritableKey, value: string): FileConfig => {
  switch (key) {
    case 'host':
      return compactFile({ ...file, host: value })
    case 'port':
      return compactFile({ ...file, port: parsePortValue(value) })
    case 'journal':
      return compactFile({ ...file, journal: value })
    case 'pi.home':
      return withPi(file, { home: value })
    case 'pi.sessionDir':
      return withPi(file, { sessionDir: value })
    case 'pi.command':
      return withPi(file, { command: value })
    case 'pi.args':
      return withPi(file, { args: parseStringArray(value) })
    case 'pi.skills':
      return withPi(file, { skills: parseStringArray(value) })
    case 'pi.noBuiltinTools':
      return withPi(file, { noBuiltinTools: parseBoolValue(value) })
    default: {
      const _exhaustive: never = key
      return _exhaustive
    }
  }
}

export const unsetFileKey = (file: FileConfig, key: WritableKey): FileConfig => {
  const dropPi = (omit: keyof FilePi): FileConfig => {
    const pi = file.pi
    if (pi === undefined) return compactFile(file)
    const next: FilePiDraft = {}
    if (omit !== 'home' && pi.home !== undefined) next.home = pi.home
    if (omit !== 'sessionDir' && pi.sessionDir !== undefined) next.sessionDir = pi.sessionDir
    if (omit !== 'command' && pi.command !== undefined) next.command = pi.command
    if (omit !== 'args' && pi.args !== undefined) next.args = pi.args
    if (omit !== 'skills' && pi.skills !== undefined) next.skills = pi.skills
    if (omit !== 'noBuiltinTools' && pi.noBuiltinTools !== undefined) {
      next.noBuiltinTools = pi.noBuiltinTools
    }
    return compactFile({
      host: file.host,
      port: file.port,
      journal: file.journal,
      pi: next,
    })
  }
  switch (key) {
    case 'host':
      return compactFile({ port: file.port, journal: file.journal, pi: file.pi })
    case 'port':
      return compactFile({ host: file.host, journal: file.journal, pi: file.pi })
    case 'journal':
      return compactFile({ host: file.host, port: file.port, pi: file.pi })
    case 'pi.home':
      return dropPi('home')
    case 'pi.sessionDir':
      return dropPi('sessionDir')
    case 'pi.command':
      return dropPi('command')
    case 'pi.args':
      return dropPi('args')
    case 'pi.skills':
      return dropPi('skills')
    case 'pi.noBuiltinTools':
      return dropPi('noBuiltinTools')
    default: {
      const _exhaustive: never = key
      return _exhaustive
    }
  }
}

const formatValue = (value: string | number | boolean | readonly string[] | undefined): string => {
  if (value === undefined) return ''
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (Array.isArray(value)) return JSON.stringify(value)
  return String(value)
}

export const listLines = (settings: Settings): readonly string[] => {
  const rows: ReadonlyArray<{
    readonly name: ConfigKeyName
    readonly value: string | number | boolean | readonly string[] | undefined
    readonly source: Source
    readonly lifetime: Lifetime
  }> = [
    { name: 'home', value: settings.home.value, source: settings.home.source, lifetime: 'startup' },
    {
      name: 'host',
      value: settings.hostname.value,
      source: settings.hostname.source,
      lifetime: 'startup',
    },
    { name: 'port', value: settings.port.value, source: settings.port.source, lifetime: 'startup' },
    {
      name: 'journal',
      value: settings.journal.value,
      source: settings.journal.source,
      lifetime: 'startup',
    },
    {
      name: 'pi.home',
      value: settings.piHome.value,
      source: settings.piHome.source,
      lifetime: 'startup',
    },
    {
      name: 'pi.sessionDir',
      value: settings.piSessionDir.value,
      source: settings.piSessionDir.source,
      lifetime: 'startup',
    },
    {
      name: 'pi.command',
      value: settings.piCommand.value,
      source: settings.piCommand.source,
      lifetime: 'startup',
    },
    {
      name: 'pi.args',
      value: settings.piArgs.value,
      source: settings.piArgs.source,
      lifetime: 'startup',
    },
    {
      name: 'pi.skills',
      value: settings.piSkills.value,
      source: settings.piSkills.source,
      lifetime: 'startup',
    },
    {
      name: 'pi.noBuiltinTools',
      value: settings.piNoBuiltinTools.value,
      source: settings.piNoBuiltinTools.source,
      lifetime: 'startup',
    },
  ]
  return rows.map(
    (row) => `${row.name}=${formatValue(row.value)} source=${row.source} lifetime=${row.lifetime}`,
  )
}

export const openSettings = (
  flags: ServeFlags,
  env: NodeJS.ProcessEnv,
  osHome: string = homedir(),
): Settings => {
  const home = resolveHome(flags.home, env, osHome)
  return resolveSettings(flags, env, loadFileConfig(home.value), osHome)
}
