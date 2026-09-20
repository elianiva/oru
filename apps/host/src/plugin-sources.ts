import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect, Option, Schema } from 'effect'
import type { AnyPlugin } from '@oru/kernel'
import { defaultFacetsRoot, loadPrebuiltRecord, readPrebuiltManifest } from './prebuilt-facets.ts'

/**
 * An external plugin the host loads the way it loads any third-party plugin:
 * by module specifier, through a dynamic import. The module default-exports
 * its plugin record: one identity with an optional `Config` and `apply`.
 * Entry-point factories are gone on purpose: configuration reaches plugins
 * as data on the def, so the loader never calls into a module, it only reads
 * the record. `oru/harness-pi` is the first such source, not a statically
 * imported member of the host.
 */
export interface PluginSource {
  readonly specifier: string
}

const PluginEnvelope = Schema.Struct({
  default: Schema.optional(Schema.Unknown),
})
const decodeEnvelope = Schema.decodeUnknownOption(PluginEnvelope)

const PluginIdentity = Schema.Struct({ id: Schema.String })
const decodeIdentity = Schema.decodeUnknownOption(PluginIdentity)

const isPlugin = (value: unknown): value is AnyPlugin => Option.isSome(decodeIdentity(value))

const defaultLog = (message: string): void => {
  process.stderr.write(`oru host: ${message}\n`)
}

/** Load one plugin source. A source that is not installed resolves to no plugins. */
export const loadPluginSource = (
  source: PluginSource,
  log: (message: string) => void = defaultLog,
  facetsRoot: string = defaultFacetsRoot(),
): Effect.Effect<readonly AnyPlugin[]> =>
  Effect.gen(function* () {
    // A prebuilt server facet on disk wins over the source import: a packed
    // host ships no plugin sources, so the built record is the only one.
    // A manifest with no readable record falls through to the source import
    // below, the way a missing manifest does, with a note naming the cause.
    const prebuilt = yield* Effect.promise(() => loadPrebuiltRecord(source.specifier, facetsRoot))
    if (prebuilt !== undefined) return [prebuilt]
    if (readPrebuiltManifest(source.specifier, facetsRoot) !== undefined) {
      yield* Effect.sync(() =>
        log(`plugin ${source.specifier} prebuilt facet unreadable, loading from source`),
      )
    }
    // The specifier is a runtime plugin address, not a static dependency: the
    // kernel's facet loader imports generation bundles the same way.
    // A source that fails to load, for any reason, resolves to no plugins:
    // the host boots without it. Rejections land in the failure channel, a
    // synchronous throw from the loader transform in the defect channel, and
    // both mean the same.
    const loaded: unknown = yield* Effect.promise(() => import(source.specifier)).pipe(
      Effect.orElseSucceed(() => undefined),
      Effect.catchDefect(() => Effect.succeed(undefined)),
    )
    const note = (message: string): Effect.Effect<readonly AnyPlugin[]> =>
      Effect.as(
        Effect.sync(() => log(message)),
        [],
      )
    if (loaded === undefined) {
      return yield* note(`plugin ${source.specifier} not found, running without it`)
    }
    const decoded = decodeEnvelope(loaded)
    if (Option.isNone(decoded) || !isPlugin(decoded.value.default)) {
      return yield* note(`plugin ${source.specifier} exported no plugin, running without it`)
    }
    return [decoded.value.default]
  })

/** Load every source in order. One missing source never stops the others. */
export const loadExternalPlugins = (
  sources: readonly PluginSource[],
  log: (message: string) => void = defaultLog,
  facetsRoot: string = defaultFacetsRoot(),
): Effect.Effect<readonly AnyPlugin[]> =>
  Effect.gen(function* () {
    const loaded: AnyPlugin[] = []
    for (const source of sources) {
      loaded.push(...(yield* loadPluginSource(source, log, facetsRoot)))
    }
    return loaded
  })

const PluginList = Schema.Array(Schema.String)
const decodePluginList = Schema.decodeUnknownOption(PluginList)

/**
 * The host package root: the nearest directory with a `package.json` walking
 * up from this module, the way the prebuilt facet store resolves.
 */
export const defaultHostRoot = (): string => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return dir
    dir = parent
  }
}

/**
 * The plugins a stock host loads, read from `oru.plugins.json` beside the
 * host package. Third-party harnesses join by extending that list, the way
 * cordis names modules in its yml. A missing or unreadable list is empty,
 * with a note naming the file: the host boots without bridges rather than
 * guessing which ones were meant.
 */
export const readPluginList = (
  hostRoot: string = defaultHostRoot(),
  log: (message: string) => void = defaultLog,
): readonly PluginSource[] => {
  const file = join(hostRoot, 'oru.plugins.json')
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const decoded = decodePluginList(raw)
    if (Option.isNone(decoded)) {
      log(`plugin list ${file} names no specifiers, running without external plugins`)
      return []
    }
    return decoded.value.map((specifier) => ({ specifier }))
  } catch {
    log(`plugin list ${file} unreadable, running without external plugins`)
    return []
  }
}
