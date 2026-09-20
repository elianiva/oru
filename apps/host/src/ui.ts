import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Effect, Option, Schema } from 'effect'
import { buildUiBundle, type FacetUiEntry } from '@oru/plugin-build'
import {
  UiDef,
  UiKind,
  UI_SDK_MAJOR,
  resolveUiAssignments,
  type UiAssignment,
  type UiBundleDescriptor,
  type UiClaim,
  type UiSnapshot,
} from '@oru/ui'
import type { AnyPlugin, Host, PluginId } from '@oru/kernel'
import type { PluginSource } from './plugin-sources.ts'
import {
  defaultFacetsRoot,
  loadPrebuiltRecord,
  readPrebuiltUi,
  type PrebuiltUi,
} from './prebuilt-facets.ts'

export interface UiOverrides {
  readonly composer?: string | undefined
  readonly conversation?: string | undefined
}

export interface BuiltUi {
  readonly plugin: PluginId
  readonly defs: readonly UiDef[]
  readonly address: string
  readonly js: string
}

export type UiBundles = ReadonlyMap<PluginId, BuiltUi>

const PackageManifest = Schema.Struct({
  oru: Schema.optional(
    Schema.Struct({
      ui: Schema.optional(Schema.Unknown),
    }),
  ),
})
const decodeManifest = Schema.decodeUnknownOption(PackageManifest)
const PluginRecordId = Schema.Struct({ id: Schema.NonEmptyString })
const decodeRecordId = Schema.decodeUnknownOption(PluginRecordId)

const FacetEnvelope = Schema.Struct({
  default: Schema.optional(Schema.Unknown),
})
const decodeEnvelope = Schema.decodeUnknownOption(FacetEnvelope)

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: entry point for untrusted plugin modules; the record id schema below is the parse
const isPluginRecord = (value: unknown): value is AnyPlugin => Option.isSome(decodeRecordId(value))

const decodeUiDef = Schema.decodeUnknownOption(UiDef)
const decodeUiEntry = Schema.decodeUnknownOption(Schema.String)

const defaultLog = (message: string): void => {
  process.stderr.write(`oru host: ${message}\n`)
}

interface FacetManifest {
  readonly dir: string
  readonly ui: string | undefined
}

const readManifest = (specifier: string): FacetManifest | undefined => {
  try {
    const require = createRequire(import.meta.url)
    // Walk up from the package's main entry: `./package.json` is not an
    // exported subpath, and the entry is what the loader itself resolves,
    // so the manifest is found for any plugin layout.
    let dir = dirname(require.resolve(specifier))
    for (;;) {
      const parent = dirname(dir)
      const pkgPath = join(dir, 'package.json')
      if (existsSync(pkgPath)) {
        const raw: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'))
        if (!isRecordWithName(raw, specifier)) {
          // A manifest for another package; keep walking up.
        } else {
          const decoded = decodeManifest(raw)
          if (Option.isNone(decoded)) return undefined
          const entry = decodeUiEntry(decoded.value.oru?.ui)
          return { dir, ui: Option.isSome(entry) ? entry.value : undefined }
        }
      }
      if (parent === dir) return undefined
      dir = parent
    }
  } catch {
    return undefined
  }
}

const PackageName = Schema.Struct({ name: Schema.String })
const decodePackageName = Schema.decodeUnknownOption(PackageName)

const isRecordWithName = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: raw manifest JSON; the name schema below is the parse
  value: unknown,
  name: string,
): boolean => {
  const decoded = decodePackageName(value)
  return Option.isSome(decoded) && decoded.value.name === name
}

const readRecord = async (specifier: string): Promise<AnyPlugin | undefined> => {
  const url = fileUrlOfSpecifier(specifier)
  const stamped = url.startsWith('file:') ? `${url}?oru=${Date.now()}` : url
  const pending: Promise<unknown> = import(stamped)
  const decoded = decodeEnvelope(await pending.catch(() => undefined))
  if (Option.isNone(decoded) || !isPluginRecord(decoded.value.default)) return undefined
  return decoded.value.default
}

const UiDefsExport = Schema.Struct({
  defs: Schema.Array(Schema.Unknown),
})
const decodeUiDefsExport = Schema.decodeUnknownOption(UiDefsExport)

const UiEntryEnvelope = Schema.Struct({
  default: Schema.optional(Schema.Unknown),
})
const decodeUiEntryEnvelope = Schema.decodeUnknownOption(UiEntryEnvelope)

/**
 * The UI claims a plugin makes: always the `defs` export of its ui entry,
 * the same single claim path the build reads. The server record never
 * claims UI.
 */
const defsOfUiEntry = async (dir: string, entry: string): Promise<readonly UiDef[]> => {
  const pending: Promise<unknown> = import(
    `${pathToFileURL(join(dir, entry)).href}?oru=${Date.now()}`
  )
  const loaded = await pending.catch(() => undefined)
  if (loaded === undefined) return []
  const envelope = decodeUiEntryEnvelope(loaded)
  const exported =
    Option.isSome(envelope) && envelope.value.default !== undefined
      ? envelope.value.default
      : loaded
  const decoded = decodeUiDefsExport(exported)
  if (Option.isNone(decoded)) return []
  const defs: UiDef[] = []
  for (const def of decoded.value.defs) {
    const pair = decodeUiDef(def)
    if (Option.isSome(pair)) defs.push(pair.value)
  }
  return defs
}

/** Every specifier resolves to a file URL first, so a re-import with a query stamp misses the ESM cache. */
export const fileUrlOfSpecifier = (specifier: string): string => {
  try {
    const require = createRequire(import.meta.url)
    return pathToFileURL(require.resolve(specifier)).href
  } catch {
    return specifier
  }
}

/** The defs a prebuilt manifest entry names, zipped back into claims. */
const defsOfPrebuilt = (entry: FacetUiEntry): readonly UiDef[] => {
  const defs: UiDef[] = []
  entry.defIds.forEach((defId, index) => {
    const slot = entry.slots[index]
    if (slot === undefined) return
    const decoded = decodeUiDef({ slot, defId })
    if (Option.isSome(decoded)) defs.push(decoded.value)
  })
  return defs
}

export interface OneUiBuild {
  readonly record: AnyPlugin
  readonly built: BuiltUi | undefined
  readonly buildError: string | undefined
}

/** Whether the source tree names a ui facet: the reload builds it from source instead of re-reading prebuilt bytes. */
export const hasSourceUi = (specifier: string): boolean => readManifest(specifier)?.ui !== undefined

export const buildOneUiBundle = (
  source: PluginSource,
  log: (message: string) => void = defaultLog,
  facetsRoot: string = defaultFacetsRoot(),
  options: { readonly preferSource?: boolean } = {},
): Effect.Effect<OneUiBuild | undefined> =>
  Effect.gen(function* () {
    if (options.preferSource) {
      const manifest = readManifest(source.specifier)
      const uiEntry = manifest?.ui
      if (manifest !== undefined && uiEntry !== undefined) {
        return yield* buildFromSource(source, manifest.dir, uiEntry, log)
      }
    }
    const prebuilt: PrebuiltUi | undefined = readPrebuiltUi(source.specifier, facetsRoot)
    if (prebuilt !== undefined) {
      const record =
        (yield* Effect.promise(() => loadPrebuiltRecord(source.specifier, facetsRoot))) ??
        (yield* Effect.promise(() => readRecord(source.specifier)))
      if (record === undefined) {
        log(`plugin ${source.specifier} exported no plugin, skipping its ui facet`)
        return undefined
      }
      const defs = defsOfPrebuilt(prebuilt.entry)
      if (defs.length === 0) return { record, built: undefined, buildError: undefined }
      return {
        record,
        built: {
          plugin: record.id,
          defs,
          address: prebuilt.entry.address,
          js: prebuilt.js,
        },
        buildError: undefined,
      }
    }
    const fallbackManifest = readManifest(source.specifier)
    const fallbackEntry = fallbackManifest?.ui
    if (fallbackManifest === undefined || fallbackEntry === undefined) {
      const record = yield* Effect.promise(() => readRecord(source.specifier))
      if (record === undefined) return undefined
      return { record, built: undefined, buildError: undefined }
    }
    return yield* buildFromSource(source, fallbackManifest.dir, fallbackEntry, log)
  })

const buildFromSource = (
  source: PluginSource,
  dir: string,
  uiEntry: string,
  log: (message: string) => void,
): Effect.Effect<OneUiBuild | undefined> =>
  Effect.gen(function* () {
    const record = yield* Effect.promise(() => readRecord(source.specifier))
    if (record === undefined) {
      log(`plugin ${source.specifier} exported no plugin, skipping its ui facet`)
      return undefined
    }
    const defs = yield* Effect.promise(() => defsOfUiEntry(dir, uiEntry))
    if (defs.length === 0) return { record, built: undefined, buildError: undefined }
    const entry = join(dir, uiEntry)
    const bundle = yield* Effect.promise(() => buildUiBundle(entry)).pipe(
      Effect.catchDefect((defect) =>
        Effect.as(
          Effect.sync(() => log(`plugin ${source.specifier} ui bundle failed: ${String(defect)}`)),
          undefined,
        ),
      ),
    )
    if (bundle === undefined) {
      return { record, built: undefined, buildError: `ui bundle failed for ${source.specifier}` }
    }
    return {
      record,
      built: { plugin: record.id, defs, address: bundle.address, js: bundle.js },
      buildError: undefined,
    }
  })

/**
 * Build every source's presentation facet once at startup. A source without
 * a `ui` facet is not a UI plugin and is skipped; a source that fails to
 * load or build is skipped with a note, the way the plugin-source loader
 * runs without a source it cannot load. The returned map is keyed by
 * plugin id, so the snapshot joins live claims to built code by identity.
 *
 * A source with prebuilt UI bytes under the host facets root serves them
 * from disk; without them the host bundles the `ui` facet from source,
 * exactly as before.
 */
export const buildUiBundles = (
  sources: readonly PluginSource[],
  log: (message: string) => void = defaultLog,
  facetsRoot: string = defaultFacetsRoot(),
): Effect.Effect<UiBundles> =>
  Effect.gen(function* () {
    const built = new Map<PluginId, BuiltUi>()
    for (const source of sources) {
      const one = yield* buildOneUiBundle(source, log, facetsRoot)
      if (one?.built === undefined) continue
      built.set(one.built.plugin, one.built)
    }
    // SAFETY: built only ever receives complete bundle records in the loop above; the empty map is the no-UI-plugin case.
    return built as UiBundles
  })

/**
 * Join live claims to built bundles. Claims come from the host, so a
 * deactivated plugin's defs vanish from the snapshot the way its services
 * vanish from the graph; bundles come from startup, so the code an
 * assignment names is always the bytes the host serves.
 */
export const uiSnapshotOf = (
  host: Host,
  built: UiBundles,
  overrides: UiOverrides,
  warn: (message: string) => void = defaultLog,
): Effect.Effect<UiSnapshot> =>
  Effect.gen(function* () {
    const entries = yield* host.contributions(UiKind)
    const claims: UiClaim[] = []
    for (const entry of entries) {
      const decoded = decodeUiDef(entry.value)
      if (Option.isSome(decoded)) claims.push({ plugin: entry.plugin, def: decoded.value })
    }
    const assignments = resolveUiAssignments(claims, overrides, warn)
    const bundles: Array<UiBundleDescriptor> = []
    const rendered: Array<UiAssignment> = []
    for (const assignment of assignments) {
      const bundle = built.get(assignment.plugin)
      if (bundle === undefined) {
        warn(`oru ui: no bundle for ${assignment.plugin}, leaving ${assignment.slot} empty`)
        continue
      }
      const def = bundle.defs.find(
        (candidate) => candidate.defId === assignment.defId && candidate.slot === assignment.slot,
      )
      if (def === undefined) {
        warn(
          `oru ui: bundle for ${assignment.plugin} carries no ${assignment.slot}/${assignment.defId}, leaving ${assignment.slot} empty`,
        )
        continue
      }
      bundles.push({
        plugin: assignment.plugin,
        defId: assignment.defId,
        slot: assignment.slot,
        address: bundle.address,
        jsUrl: `/ui/${bundle.address}.js`,
        sdkMajor: UI_SDK_MAJOR,
      })
      rendered.push(assignment)
    }
    return { bundles, assignments: rendered }
  })
