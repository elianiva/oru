import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  Config,
  ConfigProvider,
  Effect,
  Match,
  Option,
  Result,
  Schema,
  SchemaGetter,
  type ConfigProvider as ConfigProviderNs,
} from 'effect'

export const defaultHost = '127.0.0.1'

/** The port a host takes by default: out of the registered range, easy to type. */
export const defaultPort = 7317

export type Source = 'flag' | 'file' | 'env' | 'default'

export type Lifetime = 'startup' | 'live'

export interface Chosen<T> {
  readonly value: T
  readonly source: Source
}

export interface ServeFlags {
  readonly home?: string | undefined
  readonly hostname?: string | undefined
  readonly port?: number | undefined
  readonly journal?: string | undefined
}

interface FilePiDraft {
  home?: string | undefined
  sessionDir?: string | undefined
  command?: string | undefined
  args?: readonly string[] | undefined
  skills?: readonly string[] | undefined
  noBuiltinTools?: boolean | undefined
}

interface EnvPiDraft {
  home?: string | undefined
  sessionDir?: string | undefined
  command?: string | undefined
  args?: readonly string[] | undefined
  skills?: readonly string[] | undefined
  noBuiltinTools?: string | undefined
}

interface FileUiSlots {
  composer?: string | undefined
  conversation?: string | undefined
}

interface FileUi {
  slots?: FileUiSlots | undefined
}

interface FileDraft {
  host?: string | undefined
  port?: number | undefined
  journal?: string | undefined
  defaultHarness?: string | undefined
  defaultModel?: string | undefined
  pi?: FilePi | undefined
  ui?: FileUi | undefined
}

export interface CatalogKey {
  readonly name: string
  readonly path: readonly string[]
  readonly lifetime: Lifetime
}

/**
 * Names `config list` prints. Validation lives on the Effect Config schema,
 * not here. `ORU_PI_E2E_MODEL` and `ORU_PI_TOOLS_FILE` are not settings.
 */
export const catalog = [
  { name: 'home', path: ['home'], lifetime: 'startup' },
  { name: 'host', path: ['host'], lifetime: 'startup' },
  { name: 'port', path: ['port'], lifetime: 'startup' },
  { name: 'journal', path: ['journal'], lifetime: 'startup' },
  { name: 'defaultHarness', path: ['defaultHarness'], lifetime: 'startup' },
  { name: 'defaultModel', path: ['defaultModel'], lifetime: 'startup' },
  { name: 'pi.home', path: ['pi', 'home'], lifetime: 'startup' },
  { name: 'pi.sessionDir', path: ['pi', 'sessionDir'], lifetime: 'startup' },
  { name: 'pi.command', path: ['pi', 'command'], lifetime: 'startup' },
  { name: 'pi.args', path: ['pi', 'args'], lifetime: 'startup' },
  { name: 'pi.skills', path: ['pi', 'skills'], lifetime: 'startup' },
  { name: 'pi.noBuiltinTools', path: ['pi', 'noBuiltinTools'], lifetime: 'startup' },
  { name: 'ui.slots.composer', path: ['ui', 'slots', 'composer'], lifetime: 'startup' },
  { name: 'ui.slots.conversation', path: ['ui', 'slots', 'conversation'], lifetime: 'startup' },
] as const satisfies readonly CatalogKey[]

export type ConfigKeyName = (typeof catalog)[number]['name']

export type WritableKey = Exclude<ConfigKeyName, 'home'>

export const isWritableKey = (key: string): key is WritableKey =>
  key !== 'home' && catalog.some((entry) => entry.name === key)

export const configPath = (home: string): string => join(home, 'config.json')

export const dataDirOf = (home: string): string => join(home, 'data')

export const personalDirOf = (home: string): string => join(dataDirOf(home), 'personal')

export const defaultJournalOf = (home: string): string => join(dataDirOf(home), 'oru.db')

export const defaultPiHomeOf = (home: string): string => join(dataDirOf(home), 'pi')

export const defaultPiSessionDirOf = (piHome: string): string => join(piHome, 'sessions')

export const defaultHome = (osHome: string = homedir()): string => join(osHome, '.oru')

const ListenPort = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65535 }))

const StringList = Schema.Array(Schema.String)

const FilePiDocument = Schema.Struct({
  home: Schema.optional(Schema.String),
  sessionDir: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  args: Schema.optional(StringList),
  skills: Schema.optional(StringList),
  noBuiltinTools: Schema.optional(Schema.Boolean),
})

const FileUiSlotsDocument = Schema.Struct({
  composer: Schema.optional(Schema.String),
  conversation: Schema.optional(Schema.String),
})

const FileUiDocument = Schema.Struct({
  slots: Schema.optional(FileUiSlotsDocument),
})

const FileDocument = Schema.Struct({
  host: Schema.optional(Schema.String),
  port: Schema.optional(ListenPort),
  journal: Schema.optional(Schema.String),
  defaultHarness: Schema.optional(Schema.String),
  defaultModel: Schema.optional(Schema.String),
  pi: Schema.optional(FilePiDocument),
  ui: Schema.optional(FileUiDocument),
})
export type FilePi = typeof FilePiDocument.Type
export type FileConfig = typeof FileDocument.Type

const parseOptions = { onExcessProperty: 'error' as const }

const decodeJsonValue = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const decodeFileResult = Schema.decodeUnknownResult(FileDocument, parseOptions)
const decodeListenPort = Schema.decodeUnknownResult(ListenPort)
const BooleanFromConfigString = Schema.Literals([
  'true',
  'yes',
  'on',
  '1',
  'y',
  'false',
  'no',
  'off',
  '0',
  'n',
]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform(
      (value) =>
        value === 'true' || value === 'yes' || value === 'on' || value === '1' || value === 'y',
    ),
    encode: SchemaGetter.transform((value) => (value ? 'true' : 'false')),
  }),
)
const decodeBoolean = Schema.decodeUnknownResult(BooleanFromConfigString)

const decodeStringList = Schema.decodeUnknownResult(Schema.fromJsonString(StringList))

export class ConfigError extends Schema.TaggedError<ConfigError>()('ConfigError', {
  message: Schema.String,
}) {}

const fail = (message: string): never => {
  throw new ConfigError({ message })
}

const issueMessage = (error: Schema.SchemaError): string => {
  const text = error.message
  const excess = /(?:expected|unexpected|excess|unknown).*?[`'"]([^`'"]+)[`'"]/iu.exec(text)
  if (excess?.[1] !== undefined && text.toLowerCase().includes('excess')) {
    return `config.json has unknown key ${excess[1]}`
  }
  if (text.includes('token')) return `config.json has unknown key token`
  return text
}

const fromResult = <A>(result: Result.Result<A, Schema.SchemaError>, fallback: string): A => {
  if (Result.isFailure(result)) {
    const message = issueMessage(result.failure)
    return fail(message.length > 0 ? message : fallback)
  }
  return result.success
}

export const parseFileConfig = (text: string): FileConfig => {
  const json = decodeJsonValue(text)
  if (Option.isNone(json)) return fail('config.json is not JSON')
  return fromResult(decodeFileResult(json.value), 'config.json is invalid')
}

export const loadFileConfig = (home: string): FileConfig => {
  const path = configPath(home)
  if (!existsSync(path)) return {}
  return parseFileConfig(readFileSync(path, 'utf8'))
}

/** The harness and model a thread with no configuration of its own runs. */
export const defaultHarness = 'pi'

const settingsConfig = (defaults: {
  readonly home: string
  readonly journal: string
  readonly piHome: string
  readonly piSessionDir: string
  readonly defaultHarness: string
}) =>
  Config.all({
    home: Config.String('home').pipe(Config.withDefault(defaults.home)),
    hostname: Config.String('host').pipe(Config.withDefault(defaultHost)),
    port: Config.schema(ListenPort, 'port').pipe(Config.withDefault(defaultPort)),
    journal: Config.String('journal').pipe(Config.withDefault(defaults.journal)),
    defaultHarness: Config.String('defaultHarness').pipe(
      Config.withDefault(defaults.defaultHarness),
    ),
    defaultModel: Config.String('defaultModel').pipe(
      Config.option,
      Config.map(Option.getOrUndefined),
    ),
    piHome: Config.String('home').pipe(Config.nested('pi'), Config.withDefault(defaults.piHome)),
    piSessionDir: Config.String('sessionDir').pipe(
      Config.nested('pi'),
      Config.withDefault(defaults.piSessionDir),
    ),
    piCommand: Config.String('command').pipe(
      Config.nested('pi'),
      Config.option,
      Config.map(Option.getOrUndefined),
    ),
    piArgs: Config.schema(StringList, 'args').pipe(
      Config.nested('pi'),
      Config.option,
      Config.map(Option.getOrUndefined),
    ),
    piSkills: Config.schema(StringList, 'skills').pipe(
      Config.nested('pi'),
      Config.option,
      Config.map(Option.getOrUndefined),
    ),
    piNoBuiltinTools: Config.Boolean('noBuiltinTools').pipe(
      Config.nested('pi'),
      Config.withDefault(false),
    ),
    uiSlotsComposer: Config.String('composer').pipe(
      Config.nested('slots'),
      Config.nested('ui'),
      Config.option,
      Config.map(Option.getOrUndefined),
    ),
    uiSlotsConversation: Config.String('conversation').pipe(
      Config.nested('slots'),
      Config.nested('ui'),
      Config.option,
      Config.map(Option.getOrUndefined),
    ),
  })

interface ProviderTree {
  home?: string | undefined
  host?: string | undefined
  port?: number | string | undefined
  journal?: string | undefined
  defaultHarness?: string | undefined
  defaultModel?: string | undefined
  pi?: FilePi | EnvPiDraft | undefined
  ui?: FileUi | undefined
}

const treeFromFlags = (flags: ServeFlags): ProviderTree => {
  const tree: ProviderTree = {}
  if (flags.home !== undefined) tree.home = flags.home
  if (flags.hostname !== undefined) tree.host = flags.hostname
  if (flags.port !== undefined) tree.port = flags.port
  if (flags.journal !== undefined) tree.journal = flags.journal
  return tree
}

const treeFromFile = (file: FileConfig): ProviderTree => {
  const tree: ProviderTree = {}
  if (file.host !== undefined) tree.host = file.host
  if (file.port !== undefined) tree.port = file.port
  if (file.journal !== undefined) tree.journal = file.journal
  if (file.defaultHarness !== undefined) tree.defaultHarness = file.defaultHarness
  if (file.defaultModel !== undefined) tree.defaultModel = file.defaultModel
  if (file.pi !== undefined) tree.pi = file.pi
  if (file.ui !== undefined) tree.ui = file.ui
  return tree
}

const envString = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name]
  if (value === undefined || value === '') return undefined
  return value
}

const envStringList = (env: NodeJS.ProcessEnv, name: string): readonly string[] | undefined => {
  const raw = envString(env, name)
  if (raw === undefined) return undefined
  return fromResult(decodeStringList(raw), `${name} must be a JSON array of strings`)
}

const treeFromEnv = (env: NodeJS.ProcessEnv): ProviderTree => {
  const tree: ProviderTree = {}
  const home = envString(env, 'ORU_HOME')
  const host = envString(env, 'ORU_HOST')
  const port = envString(env, 'ORU_PORT')
  const journal = envString(env, 'ORU_JOURNAL')
  const defaultHarness = envString(env, 'ORU_DEFAULT_HARNESS')
  const defaultModel = envString(env, 'ORU_DEFAULT_MODEL')
  if (home !== undefined) tree.home = home
  if (host !== undefined) tree.host = host
  if (port !== undefined) tree.port = port
  if (journal !== undefined) tree.journal = journal
  if (defaultHarness !== undefined) tree.defaultHarness = defaultHarness
  if (defaultModel !== undefined) tree.defaultModel = defaultModel
  const pi: EnvPiDraft = {}
  const piHome = envString(env, 'ORU_PI_HOME')
  const sessionDir = envString(env, 'ORU_PI_SESSION_DIR')
  const command = envString(env, 'ORU_PI_COMMAND')
  const args = envStringList(env, 'ORU_PI_ARGS')
  const skills = envStringList(env, 'ORU_PI_SKILLS')
  const noBuiltin = envString(env, 'ORU_PI_NO_BUILTIN_TOOLS')
  if (piHome !== undefined) pi.home = piHome
  if (sessionDir !== undefined) pi.sessionDir = sessionDir
  if (command !== undefined) pi.command = command
  if (args !== undefined) pi.args = args
  if (skills !== undefined) pi.skills = skills
  if (noBuiltin !== undefined) pi.noBuiltinTools = noBuiltin
  if (Object.keys(pi).length > 0) tree.pi = pi
  const uiComposer = envString(env, 'ORU_UI_SLOTS_COMPOSER')
  const uiConversation = envString(env, 'ORU_UI_SLOTS_CONVERSATION')
  if (uiComposer !== undefined || uiConversation !== undefined) {
    const slots: FileUiSlots = {}
    if (uiComposer !== undefined) slots.composer = uiComposer
    if (uiConversation !== undefined) slots.conversation = uiConversation
    tree.ui = { slots }
  }
  return tree
}

const layered = (
  flags: ServeFlags,
  env: NodeJS.ProcessEnv,
  file: FileConfig,
  home: string,
): ConfigProvider.ConfigProvider => {
  const defaults: ProviderTree = {
    home,
    host: defaultHost,
    port: defaultPort,
    journal: defaultJournalOf(home),
    defaultHarness,
    pi: {
      home: defaultPiHomeOf(home),
      sessionDir: defaultPiSessionDirOf(defaultPiHomeOf(home)),
      noBuiltinTools: false,
    },
  }
  return ConfigProvider.fromUnknown(treeFromFlags(flags)).pipe(
    ConfigProvider.orElse(ConfigProvider.fromUnknown(treeFromFile(file))),
    ConfigProvider.orElse(ConfigProvider.fromUnknown(treeFromEnv(env))),
    ConfigProvider.orElse(ConfigProvider.fromUnknown(defaults)),
  )
}

const leafPresent = (node: ConfigProviderNs.Node | undefined): boolean => {
  if (node === undefined) return false
  return Match.value(node).pipe(
    Match.tag('Value', () => true),
    Match.tag('Array', (node) => node.length > 0),
    Match.orElse((node) => node.value !== undefined),
  )
}

const sourceAt = (
  path: readonly string[],
  flags: ServeFlags,
  env: NodeJS.ProcessEnv,
  file: FileConfig,
): Source => {
  const layers: ReadonlyArray<readonly [Source, ConfigProvider.ConfigProvider]> = [
    ['flag', ConfigProvider.fromUnknown(treeFromFlags(flags))],
    ['file', ConfigProvider.fromUnknown(treeFromFile(file))],
    ['env', ConfigProvider.fromUnknown(treeFromEnv(env))],
  ]
  for (const [source, provider] of layers) {
    const node = Effect.runSync(provider.load([...path]))
    if (leafPresent(node)) return source
  }
  return 'default'
}

const runConfig = <A>(config: Config.Config<A>, provider: ConfigProvider.ConfigProvider): A => {
  try {
    return Effect.runSync(config.parse(provider))
  } catch (cause) {
    if (cause instanceof Config.ConfigError) return fail(cause.message)
    throw cause
  }
}

export interface Settings {
  readonly home: Chosen<string>
  readonly hostname: Chosen<string>
  readonly port: Chosen<number>
  readonly journal: Chosen<string>
  readonly dataDir: string
  readonly defaultHarness: Chosen<string>
  readonly defaultModel: Chosen<string | undefined>
  readonly piHome: Chosen<string>
  readonly piSessionDir: Chosen<string>
  readonly piCommand: Chosen<string | undefined>
  readonly piArgs: Chosen<readonly string[] | undefined>
  readonly piSkills: Chosen<readonly string[] | undefined>
  readonly piNoBuiltinTools: Chosen<boolean>
  readonly uiSlotsComposer: Chosen<string | undefined>
  readonly uiSlotsConversation: Chosen<string | undefined>
}

export const resolveHome = (
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
  osHome: string,
): Chosen<string> => {
  const flags: ServeFlags = flag === undefined ? {} : { home: flag }
  const provider = ConfigProvider.fromUnknown(treeFromFlags(flags)).pipe(
    ConfigProvider.orElse(ConfigProvider.fromUnknown(treeFromEnv(env))),
    ConfigProvider.orElse(ConfigProvider.fromUnknown({ home: defaultHome(osHome) })),
  )
  const value = runConfig(Config.String('home'), provider)
  return { value, source: sourceAt(['home'], flags, env, {}) }
}

export const resolveSettings = (
  flags: ServeFlags,
  env: NodeJS.ProcessEnv,
  file: FileConfig,
  osHome: string,
): Settings => {
  const home = resolveHome(flags.home, env, osHome)
  const parsed = runConfig(
    settingsConfig({
      home: home.value,
      journal: defaultJournalOf(home.value),
      piHome: defaultPiHomeOf(home.value),
      piSessionDir: defaultPiSessionDirOf(defaultPiHomeOf(home.value)),
      defaultHarness,
    }),
    layered(flags, env, file, home.value),
  )
  const src = (path: readonly string[]): Source => sourceAt(path, flags, env, file)
  const sessionSource = src(['pi', 'sessionDir'])
  return {
    home,
    hostname: { value: parsed.hostname, source: src(['host']) },
    port: { value: parsed.port, source: src(['port']) },
    journal: { value: parsed.journal, source: src(['journal']) },
    dataDir: dataDirOf(home.value),
    defaultHarness: { value: parsed.defaultHarness, source: src(['defaultHarness']) },
    defaultModel: { value: parsed.defaultModel, source: src(['defaultModel']) },
    piHome: { value: parsed.piHome, source: src(['pi', 'home']) },
    piSessionDir:
      sessionSource === 'default'
        ? { value: defaultPiSessionDirOf(parsed.piHome), source: 'default' }
        : { value: parsed.piSessionDir, source: sessionSource },
    piCommand: { value: parsed.piCommand, source: src(['pi', 'command']) },
    piArgs: { value: parsed.piArgs, source: src(['pi', 'args']) },
    piSkills: { value: parsed.piSkills, source: src(['pi', 'skills']) },
    piNoBuiltinTools: { value: parsed.piNoBuiltinTools, source: src(['pi', 'noBuiltinTools']) },
    uiSlotsComposer: { value: parsed.uiSlotsComposer, source: src(['ui', 'slots', 'composer']) },
    uiSlotsConversation: {
      value: parsed.uiSlotsConversation,
      source: src(['ui', 'slots', 'conversation']),
    },
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
  mkdirSync(personalDirOf(home), { recursive: true, mode: 0o700 })
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

const compactUiSlots = (slots: FileUiSlots): FileUiSlots | undefined => {
  const next: FileUiSlots = {}
  if (slots.composer !== undefined) next.composer = slots.composer
  if (slots.conversation !== undefined) next.conversation = slots.conversation
  if (Object.keys(next).length === 0) return undefined
  return next
}

const compactFile = (file: FileConfig): FileConfig => {
  const next: FileDraft = {}
  if (file.host !== undefined) next.host = file.host
  if (file.port !== undefined) next.port = file.port
  if (file.journal !== undefined) next.journal = file.journal
  if (file.defaultHarness !== undefined) next.defaultHarness = file.defaultHarness
  if (file.defaultModel !== undefined) next.defaultModel = file.defaultModel
  if (file.pi !== undefined) {
    const pi = compactPi(file.pi)
    if (pi !== undefined) next.pi = pi
  }
  if (file.ui?.slots !== undefined) {
    const slots = compactUiSlots(file.ui.slots)
    if (slots !== undefined) next.ui = { slots }
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
    defaultHarness: file.defaultHarness,
    defaultModel: file.defaultModel,
    pi,
    ui: file.ui,
  })
}

const withUiSlots = (file: FileConfig, patch: FileUiSlots): FileConfig => {
  const current = file.ui?.slots ?? {}
  const slots: FileUiSlots = {}
  const composer = patch.composer ?? current.composer
  const conversation = patch.conversation ?? current.conversation
  if (composer !== undefined) slots.composer = composer
  if (conversation !== undefined) slots.conversation = conversation
  return compactFile({
    host: file.host,
    port: file.port,
    journal: file.journal,
    defaultHarness: file.defaultHarness,
    defaultModel: file.defaultModel,
    pi: file.pi,
    ui: { slots },
  })
}

export const setFileKey = (file: FileConfig, key: WritableKey, value: string): FileConfig => {
  switch (key) {
    case 'host':
      return compactFile({ ...file, host: value })
    case 'port':
      return compactFile({
        ...file,
        port: fromResult(decodeListenPort(Number(value)), `port takes a port number, got ${value}`),
      })
    case 'journal':
      return compactFile({ ...file, journal: value })
    case 'defaultHarness':
      return compactFile({ ...file, defaultHarness: value })
    case 'defaultModel':
      return compactFile({ ...file, defaultModel: value })
    case 'pi.home':
      return withPi(file, { home: value })
    case 'pi.sessionDir':
      return withPi(file, { sessionDir: value })
    case 'pi.command':
      return withPi(file, { command: value })
    case 'pi.args':
      return withPi(file, {
        args: fromResult(decodeStringList(value), 'that key takes a JSON array of strings'),
      })
    case 'pi.skills':
      return withPi(file, {
        skills: fromResult(decodeStringList(value), 'that key takes a JSON array of strings'),
      })
    case 'pi.noBuiltinTools':
      return withPi(file, {
        noBuiltinTools: fromResult(
          decodeBoolean(value),
          `pi.noBuiltinTools takes 1, 0, true, or false, got ${value}`,
        ),
      })
    case 'ui.slots.composer':
      return withUiSlots(file, { composer: value })
    case 'ui.slots.conversation':
      return withUiSlots(file, { conversation: value })
    default: {
      const _exhaustive: never = key
      return _exhaustive
    }
  }
}

export const unsetFileKey = (file: FileConfig, key: WritableKey): FileConfig => {
  /** Every top-level key but the one being unset. */
  const keepScalars = (
    omit: 'host' | 'port' | 'journal' | 'defaultHarness' | 'defaultModel' | undefined,
  ): FileDraft => {
    const next: FileDraft = {}
    if (omit !== 'host' && file.host !== undefined) next.host = file.host
    if (omit !== 'port' && file.port !== undefined) next.port = file.port
    if (omit !== 'journal' && file.journal !== undefined) next.journal = file.journal
    if (omit !== 'defaultHarness' && file.defaultHarness !== undefined) {
      next.defaultHarness = file.defaultHarness
    }
    if (omit !== 'defaultModel' && file.defaultModel !== undefined) {
      next.defaultModel = file.defaultModel
    }
    return next
  }
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
    return compactFile({ ...keepScalars(undefined), pi: next, ui: file.ui })
  }
  const dropUiSlots = (omit: keyof FileUiSlots): FileConfig => {
    const slots = file.ui?.slots
    if (slots === undefined) return compactFile(file)
    const next: FileUiSlots = {}
    if (omit !== 'composer' && slots.composer !== undefined) next.composer = slots.composer
    if (omit !== 'conversation' && slots.conversation !== undefined) {
      next.conversation = slots.conversation
    }
    return compactFile({ ...keepScalars(undefined), pi: file.pi, ui: { slots: next } })
  }
  switch (key) {
    case 'host':
      return compactFile({ ...keepScalars('host'), pi: file.pi, ui: file.ui })
    case 'port':
      return compactFile({ ...keepScalars('port'), pi: file.pi, ui: file.ui })
    case 'journal':
      return compactFile({ ...keepScalars('journal'), pi: file.pi, ui: file.ui })
    case 'defaultHarness':
      return compactFile({ ...keepScalars('defaultHarness'), pi: file.pi, ui: file.ui })
    case 'defaultModel':
      return compactFile({ ...keepScalars('defaultModel'), pi: file.pi, ui: file.ui })
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
    case 'ui.slots.composer':
      return dropUiSlots('composer')
    case 'ui.slots.conversation':
      return dropUiSlots('conversation')
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

const chosenOf = (
  settings: Settings,
  name: ConfigKeyName,
): Chosen<string | number | boolean | readonly string[] | undefined> => {
  switch (name) {
    case 'home':
      return settings.home
    case 'host':
      return settings.hostname
    case 'port':
      return settings.port
    case 'journal':
      return settings.journal
    case 'defaultHarness':
      return settings.defaultHarness
    case 'defaultModel':
      return settings.defaultModel
    case 'pi.home':
      return settings.piHome
    case 'pi.sessionDir':
      return settings.piSessionDir
    case 'pi.command':
      return settings.piCommand
    case 'pi.args':
      return settings.piArgs
    case 'pi.skills':
      return settings.piSkills
    case 'pi.noBuiltinTools':
      return settings.piNoBuiltinTools
    case 'ui.slots.composer':
      return settings.uiSlotsComposer
    case 'ui.slots.conversation':
      return settings.uiSlotsConversation
    default: {
      const _exhaustive: never = name
      return _exhaustive
    }
  }
}

export const listLines = (settings: Settings): readonly string[] =>
  catalog.map((key) => {
    const chosen = chosenOf(settings, key.name)
    return `${key.name}=${formatValue(chosen.value)} source=${chosen.source} lifetime=${key.lifetime}`
  })

export const openSettings = (
  flags: ServeFlags,
  env: NodeJS.ProcessEnv,
  osHome: string = homedir(),
): Settings => {
  const home = resolveHome(flags.home, env, osHome)
  return resolveSettings(flags, env, loadFileConfig(home.value), osHome)
}
