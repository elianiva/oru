import { Effect, Option, Schema } from 'effect'
import type { AnyPlugin } from '@oru/kernel'

/**
 * An external plugin the host loads the way it loads any third-party plugin:
 * by module specifier, through a dynamic import. The module exports its plugin
 * as a `default` or `plugin` record. Entry-point factories are gone on
 * purpose: configuration reaches plugins as services, so the loader never
 * calls into a module, it only reads the record. `oru/harness-pi` is the
 * first such source, not a statically imported member of the host.
 */
export interface PluginSource {
  readonly specifier: string
}

const PluginEnvelope = Schema.Struct({
  default: Schema.optional(Schema.Unknown),
  plugin: Schema.optional(Schema.Unknown),
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
): Effect.Effect<readonly AnyPlugin[]> =>
  Effect.gen(function* () {
    // The specifier is a runtime plugin address, not a static dependency: the
    // kernel's facet loader imports generation bundles the same way.
    // A source that fails to load, for any reason, resolves to no plugins:
    // the host boots without it, the way the old try/catch around the import
    // did. Rejections land in the failure channel, a synchronous throw from
    // the loader transform in the defect channel, and both mean the same.
    const loaded: unknown = yield* Effect.promise(
      () => import(/* @vite-ignore */ source.specifier),
    ).pipe(
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
    if (Option.isNone(decoded)) {
      return yield* note(`plugin ${source.specifier} exported no plugin, running without it`)
    }
    const module = decoded.value
    for (const record of [module.default, module.plugin]) {
      if (isPlugin(record)) return [record]
    }
    return yield* note(`plugin ${source.specifier} exported no plugin, running without it`)
  })

/** Load every source in order. One missing source never stops the others. */
export const loadExternalPlugins = (
  sources: readonly PluginSource[],
  log: (message: string) => void = defaultLog,
): Effect.Effect<readonly AnyPlugin[]> =>
  Effect.gen(function* () {
    const loaded: AnyPlugin[] = []
    for (const source of sources) {
      loaded.push(...(yield* loadPluginSource(source, log)))
    }
    return loaded
  })

/** The plugins a stock host loads. Third-party harnesses join by extending this list. */
export const defaultPluginSources: readonly PluginSource[] = [
  { specifier: '@oru/harness-pi' },
  { specifier: '@oru/harness-claude-code' },
]
