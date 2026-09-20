import { Effect, PubSub, Ref, Stream } from 'effect'
import { ReloadFailed, ReloadResult, UnknownPlugin, type ViewGraph } from '@oru/rpc'
import type {
  ActivationError,
  AnyPlugin,
  BundleAddress,
  Host,
  PluginId,
  ThreadId,
} from '@oru/kernel'
import type { UiSnapshot } from '@oru/ui'
import { viewGraphOf } from './graph.ts'
import type { PluginSource } from './plugin-sources.ts'
import { defaultFacetsRoot, readPrebuiltUi } from './prebuilt-facets.ts'
import {
  buildOneUiBundle,
  hasSourceUi,
  uiSnapshotOf,
  type BuiltUi,
  type UiBundles,
  type UiOverrides,
} from './ui.ts'

export { ReloadFailed, ReloadResult, UnknownPlugin }

export interface PluginStore {
  readonly graphView: (thread?: ThreadId) => Effect.Effect<ViewGraph>
  readonly uiSnapshot: () => Effect.Effect<UiSnapshot>
  readonly bundleJs: (address: string) => Effect.Effect<string | undefined>
  readonly pluginRecord: (id: PluginId) => Effect.Effect<AnyPlugin | undefined>
  readonly reload: (specifier: string) => Effect.Effect<ReloadResult, UnknownPlugin | ReloadFailed>
  readonly changes: Stream.Stream<void>
}

export interface PluginStoreEnv {
  readonly host: Host
  readonly plugins: readonly AnyPlugin[]
  readonly sources: readonly PluginSource[]
  readonly facetsRoot?: string | undefined
  readonly overrides?: UiOverrides | undefined
  readonly log?: ((message: string) => void) | undefined
}

/** What the store remembers per plugin: the live record, how to re-read it, and whether boot resolved prebuilt bytes — so a reload serves source edits when a source facet exists instead of stale prebuilt bytes. */
interface StoredPlugin {
  readonly record: AnyPlugin
  readonly specifier?: string | undefined
  readonly prebuilt: boolean
}

const stripJsSuffix = (address: string): string =>
  address.endsWith('.js') ? address.slice(0, -3) : address

/** A cutover refusal in the verb's words: the kernel's discriminated union, rendered. */
const reasonOf = (error: ActivationError): string => {
  switch (error._tag) {
    case 'SetupFailed':
      return String(error.cause)
    case 'CoeffectsUnmet':
      return `missing inject: ${error.missing.join(', ')}`
    case 'DuplicateProvider':
      return `duplicate provider for ${String(error.token)} (owned by ${error.existing})`
  }
}

export const makePluginStore = (env: PluginStoreEnv): Effect.Effect<PluginStore> =>
  Effect.gen(function* () {
    const log = env.log ?? ((message: string) => process.stderr.write(`oru host: ${message}\n`))
    const facetsRoot = env.facetsRoot ?? defaultFacetsRoot()
    const overrides = env.overrides ?? {}

    const records = new Map<PluginId, StoredPlugin>()
    for (const plugin of env.plugins) records.set(plugin.id, { record: plugin, prebuilt: false })

    const bundles = new Map<PluginId, BuiltUi>()
    const bytes = new Map<string, string>()
    for (const source of env.sources) {
      const one = yield* buildOneUiBundle(source, log, facetsRoot)
      if (one === undefined) continue
      records.set(one.record.id, {
        record: one.record,
        specifier: source.specifier,
        prebuilt: readPrebuiltUi(source.specifier, facetsRoot) !== undefined,
      })
      if (one.built !== undefined) {
        bundles.set(one.built.plugin, one.built)
        bytes.set(one.built.address, one.built.js)
      }
    }
    const recordsRef = yield* Ref.make<ReadonlyMap<PluginId, StoredPlugin>>(records)
    const bundlesRef = yield* Ref.make<UiBundles>(bundles)
    const bytesRef = yield* Ref.make<ReadonlyMap<string, string>>(bytes)
    const signal = yield* PubSub.unbounded<void>()

    const currentPlugins = Effect.map(Ref.get(recordsRef), (map) =>
      [...map.values()].map((entry) => entry.record),
    )

    const graphView = (thread?: ThreadId) =>
      Effect.flatMap(currentPlugins, (plugins) => viewGraphOf(env.host, plugins, thread))

    const uiSnapshot = () =>
      Effect.flatMap(Ref.get(bundlesRef), (built) => uiSnapshotOf(env.host, built, overrides))

    const bundleJs = (address: string) =>
      Effect.map(Ref.get(bytesRef), (map) => map.get(stripJsSuffix(address)))

    const pluginRecord = (id: PluginId) =>
      Effect.map(Ref.get(recordsRef), (map) => map.get(id)?.record)

    const reload = (specifier: string): Effect.Effect<ReloadResult, UnknownPlugin | ReloadFailed> =>
      Effect.gen(function* () {
        const known = yield* Ref.get(recordsRef)
        const match = [...known.entries()].find(
          ([id, entry]) => id === specifier || entry.specifier === specifier,
        )
        if (match === undefined) {
          const names = [...known.keys()].sort()
          return yield* Effect.fail(new UnknownPlugin({ specifier, known: names }))
        }
        const [id, entry] = match
        const source = entry.specifier
        if (source === undefined) {
          return yield* Effect.fail(
            new ReloadFailed({ specifier, reason: `no source specifier for ${id}` }),
          )
        }
        if (
          entry.prebuilt &&
          !hasSourceUi(source) &&
          readPrebuiltUi(source, facetsRoot) === undefined
        ) {
          return yield* Effect.fail(
            new ReloadFailed({
              specifier,
              reason: `prebuilt facet for ${source} is missing or unreadable — keeping the running generation`,
            }),
          )
        }
        const fromSource = hasSourceUi(source)
        const one = yield* buildOneUiBundle({ specifier: source }, log, facetsRoot, {
          preferSource: fromSource,
        })
        if (one === undefined) {
          return yield* Effect.fail(
            new ReloadFailed({ specifier, reason: `plugin ${source} exported no plugin` }),
          )
        }
        if (one.buildError !== undefined) {
          return yield* Effect.fail(new ReloadFailed({ specifier, reason: one.buildError }))
        }
        if (one.record.id !== id) {
          return yield* Effect.fail(
            new ReloadFailed({
              specifier,
              reason: `plugin id changed from ${id} to ${one.record.id}`,
            }),
          )
        }
        const previousBundles = yield* Ref.get(bundlesRef)
        const previousBytes = yield* Ref.get(bytesRef)
        const previousRecord = (yield* Ref.get(recordsRef)).get(id)
        yield* Ref.update(recordsRef, (map) =>
          new Map(map).set(id, {
            record: one.record,
            specifier: source,
            prebuilt: !fromSource && readPrebuiltUi(source, facetsRoot) !== undefined,
          }),
        )
        yield* Ref.update(bundlesRef, (map) => {
          const next = new Map(map)
          if (one.built === undefined) next.delete(id)
          else next.set(id, one.built)
          return next
        })
        if (one.built !== undefined) {
          const built = one.built
          yield* Ref.update(bytesRef, (map) => new Map(map).set(built.address, built.js))
        }
        // SAFETY: bundle addresses are content hashes in the 64-hex BundleAddress
        // shape (buildUiBundle/prebuilt entry); the cast names that invariant.
        const generation = one.built?.address as BundleAddress | undefined
        yield* env.host.replace(one.record, generation).pipe(
          Effect.mapError(
            (error): ReloadFailed => new ReloadFailed({ specifier, reason: reasonOf(error) }),
          ),
          Effect.onError(() =>
            Effect.gen(function* () {
              yield* Ref.update(recordsRef, (map) =>
                previousRecord === undefined
                  ? (() => {
                      const next = new Map(map)
                      next.delete(id)
                      return next
                    })()
                  : new Map(map).set(id, previousRecord),
              )
              yield* Ref.set(bundlesRef, previousBundles)
              yield* Ref.set(bytesRef, previousBytes)
            }),
          ),
        )
        yield* PubSub.publish(signal, undefined)
        const graph = yield* Effect.flatMap(currentPlugins, (plugins) =>
          viewGraphOf(env.host, plugins),
        )
        const ui = yield* Effect.flatMap(Ref.get(bundlesRef), (built) =>
          uiSnapshotOf(env.host, built, overrides),
        )
        const result: ReloadResult =
          one.built === undefined
            ? { plugin: id, graph, ui }
            : { plugin: id, address: one.built.address, graph, ui }
        return result
      })

    return {
      graphView,
      uiSnapshot,
      bundleJs,
      pluginRecord,
      reload,
      changes: Stream.fromPubSub(signal),
    }
  })
