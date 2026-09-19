import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { Effect, Option, Predicate, Schema } from 'effect'
import { buildUiBundle } from '@oru/plugin-build'
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
      facets: Schema.optional(
        Schema.Struct({
          ui: Schema.optional(Schema.Unknown),
        }),
      ),
    }),
  ),
})
const decodeManifest = Schema.decodeUnknownOption(PackageManifest)
const PluginRecordId = Schema.Struct({ id: Schema.NonEmptyString })
const decodeRecordId = Schema.decodeUnknownOption(PluginRecordId)

const FacetEnvelope = Schema.Struct({
  default: Schema.optional(Schema.Unknown),
  plugin: Schema.optional(Schema.Unknown),
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
          const entry = decodeUiEntry(decoded.value.oru?.facets?.ui)
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
  const decoded = decodeEnvelope(await import(/* @vite-ignore */ specifier).catch(() => undefined))
  if (Option.isNone(decoded)) return undefined
  for (const record of [decoded.value.default, decoded.value.plugin]) {
    if (isPluginRecord(record)) return record
  }
  return undefined
}

const defsOf = (record: AnyPlugin): readonly UiDef[] => {
  const defs: UiDef[] = []
  for (const provided of record.provides) {
    if (!Predicate.isTagged(provided, 'Data')) continue
    if (provided.kind !== UiKind.id) continue
    const decoded = decodeUiDef(provided.value)
    if (Option.isSome(decoded)) defs.push(decoded.value)
  }
  return defs
}

/**
 * Build every source's presentation facet once at startup. A source without
 * a `ui` facet is not a UI plugin and is skipped; a source that fails to
 * load or build is skipped with a note, the way the plugin-source loader
 * runs without a source it cannot load. The returned map is keyed by
 * plugin id, so the snapshot joins live claims to built code by identity.
 */
export const buildUiBundles = (
  sources: readonly PluginSource[],
  log: (message: string) => void = defaultLog,
): Effect.Effect<UiBundles> =>
  Effect.gen(function* () {
    const built = new Map<PluginId, BuiltUi>()
    for (const source of sources) {
      const manifest = readManifest(source.specifier)
      if (manifest?.ui === undefined) continue
      const record = yield* Effect.promise(() => readRecord(source.specifier))
      if (record === undefined) {
        log(`plugin ${source.specifier} exported no plugin, skipping its ui facet`)
        continue
      }
      const defs = defsOf(record)
      if (defs.length === 0) continue
      const entry = join(manifest.dir, manifest.ui)
      const bundle = yield* Effect.promise(() => buildUiBundle(entry)).pipe(
        Effect.catchDefect((defect) =>
          Effect.as(
            Effect.sync(() =>
              log(`plugin ${source.specifier} ui bundle failed: ${String(defect)}`),
            ),
            undefined,
          ),
        ),
      )
      if (bundle === undefined) continue
      built.set(record.id, { plugin: record.id, defs, address: bundle.address, js: bundle.js })
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
