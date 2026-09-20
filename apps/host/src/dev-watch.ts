import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  watch,
  type Dirent,
  type FSWatcher,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { Effect, Option, Schema } from 'effect'
import { buildUiBundle } from '@oru/plugin-build'
import { PluginReloadClient, reloadFor, type ReloadResult } from '@oru/rpc'

export const defaultDebounceMs = 150

export class DevTargetError extends Schema.TaggedError<DevTargetError>()('DevTargetError', {
  message: Schema.String,
}) {}

export interface DevTarget {
  readonly dir: string
  readonly specifier: string
  readonly uiEntry: string | undefined
}

const DevManifest = Schema.Struct({
  name: Schema.optional(Schema.String),
  oru: Schema.optional(Schema.Struct({ ui: Schema.optional(Schema.String) })),
})
const decodeDevManifest = Schema.decodeUnknownOption(DevManifest)
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

const readManifestOf = (dir: string) => {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return { name: undefined, ui: undefined }
  const json = decodeJson(readFileSync(manifestPath, 'utf8'))
  if (Option.isNone(json)) return { name: undefined, ui: undefined }
  const decoded = decodeDevManifest(json.value)
  if (Option.isNone(decoded)) return { name: undefined, ui: undefined }
  return { name: decoded.value.name, ui: decoded.value.oru?.ui }
}

export const resolveDevTarget = (path: string): DevTarget => {
  const absolute = resolve(path)
  if (!existsSync(absolute)) {
    throw new DevTargetError({ message: `plugin dev: ${path} does not exist` })
  }
  const dir = statSync(absolute).isDirectory() ? absolute : dirname(absolute)
  const manifest = readManifestOf(dir)
  return { dir, specifier: manifest.name ?? absolute, uiEntry: manifest.ui }
}

export const shouldIgnore = (rel: string): boolean =>
  rel.split(sep).some((part) => part === 'node_modules' || part === 'dist' || part.startsWith('.'))

export const shortAddress = (address: string): string =>
  address.length <= 8 ? address : `${address.slice(0, 4)}…${address.slice(-2)}`

export const describeReload = (result: ReloadResult): string => {
  if (result.address === undefined) return `reloaded ${result.plugin} (no ui)`
  const slots = [...new Set(result.ui.assignments.map((assignment) => assignment.slot))].join(',')
  return `reloaded ${result.plugin} address ${shortAddress(result.address)} slots ${slots}`
}

export interface DevWatchOptions {
  readonly url: string
  readonly debounceMs?: number | undefined
  readonly log?: ((line: string) => void) | undefined
}

const collectDirs = (root: string): readonly string[] => {
  const out: string[] = [root]
  const stack: string[] = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (dir === undefined || !existsSync(dir)) continue
    const entries: readonly Dirent[] = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (shouldIgnore(relative(root, join(dir, entry.name)))) continue
      out.push(join(dir, entry.name))
      stack.push(join(dir, entry.name))
    }
  }
  return out
}

const runCycle = async (
  target: DevTarget,
  url: string,
  log: (line: string) => void,
): Promise<void> => {
  if (target.uiEntry !== undefined) {
    try {
      await buildUiBundle(join(target.dir, target.uiEntry))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      log(`[dev] build failed: ${reason} — keeping old bundle, still watching`)
      return
    }
  }
  const program = Effect.gen(function* () {
    const client = yield* PluginReloadClient
    return yield* client.reload(target.specifier)
  }).pipe(Effect.provide(reloadFor(url)))
  const outcome = await Effect.runPromise(
    Effect.scoped(program).pipe(
      Effect.match({
        onFailure: (error) => ({ reloaded: false as const, error }),
        onSuccess: (result) => ({ reloaded: true as const, result }),
      }),
    ),
  )
  if (outcome.reloaded) {
    log(`[dev] ${describeReload(outcome.result)}`)
    return
  }
  const error = outcome.error
  switch (error._tag) {
    case 'UnknownPlugin':
      log(
        `[dev] unknown plugin "${error.specifier}" (this host serves: ${error.known.join(', ') || 'nothing'})`,
      )
      return
    case 'ReloadFailed':
      log(`[dev] reload failed: ${error.reason} — keeping old bundle, still watching`)
      return
    default:
      log(`[dev] host at ${url} unreachable: ${error.reason} — still watching`)
      return
  }
}

/**
 * Watch a plugin dir and reload it over RPC per save burst. The local bundle
 * is only a gate: its bytes never cross RPC, the server rebuilds from source.
 * Throws when the path does not exist; every later failure logs one line and
 * keeps watching. Returns a stop function closing every watcher.
 */
export const startDevWatch = (path: string, options: DevWatchOptions): (() => void) => {
  const target = resolveDevTarget(path)
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`))
  const debounceMs = options.debounceMs ?? defaultDebounceMs
  const watched = new Set<string>()
  const watchers: FSWatcher[] = []
  let timer: NodeJS.Timeout | undefined
  let chain: Promise<void> = Promise.resolve()
  const onFile = (dir: string, filename: string | null): void => {
    if (filename !== null && shouldIgnore(relative(target.dir, join(dir, filename)))) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      chain = chain.then(() => runCycle(target, options.url, log))
    }, debounceMs)
  }
  const rescan = (): void => {
    for (const dir of collectDirs(target.dir)) {
      if (watched.has(dir)) continue
      watched.add(dir)
      const watcher = watch(dir, (event, filename) => onFile(dir, filename))
      watcher.on('error', (cause: unknown) => {
        const reason = cause instanceof Error ? cause.message : String(cause)
        log(`[dev] watch error: ${reason} — still watching`)
      })
      watchers.push(watcher)
    }
  }
  log(`watching ${path} as ${target.specifier} (debounced ${debounceMs}ms)…`)
  rescan()
  const rescanTimer = setInterval(rescan, 2000)
  return () => {
    clearTimeout(timer)
    clearInterval(rescanTimer)
    for (const watcher of watchers.splice(0)) watcher.close()
  }
}
