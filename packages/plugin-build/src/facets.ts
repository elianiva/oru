import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Option, Schema } from 'effect'
import { addressOf } from './address.ts'
import { buildFacet } from './build.ts'
import { buildUiBundle } from './ui-bundle.ts'

export class FacetManifestError extends Schema.TaggedError<FacetManifestError>()(
  'FacetManifestError',
  {
    message: Schema.String,
  },
) {}

export const FacetServerEntry = Schema.Struct({
  address: Schema.String,
  file: Schema.String,
})
export type FacetServerEntry = typeof FacetServerEntry.Type

export const FacetUiEntry = Schema.Struct({
  address: Schema.String,
  file: Schema.String,
  defIds: Schema.Array(Schema.String),
  slots: Schema.Array(Schema.String),
})
export type FacetUiEntry = typeof FacetUiEntry.Type

/**
 * What a plugin `build` leaves in `dist/facets.json`: the content address
 * and dist-relative path of its server facet (null when the plugin has no
 * server facet), plus one entry per UI facet with the definition ids and
 * slots the bundle carries. The host serves `/ui/<address>.js` from these
 * bytes, so the address is the same `addressOf` the in-memory bundle uses
 * and the URLs never change between source and prebuilt serving.
 */
export const FacetManifest = Schema.Struct({
  server: Schema.Union([FacetServerEntry, Schema.Null]),
  ui: Schema.Array(FacetUiEntry),
})
export type FacetManifest = typeof FacetManifest.Type

export const decodeFacetManifest = Schema.decodeUnknownOption(FacetManifest)

const PackageFacets = Schema.Struct({
  oru: Schema.optional(
    Schema.Struct({
      facets: Schema.optional(
        Schema.Struct({
          server: Schema.optional(Schema.String),
          ui: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
})
const decodePackageFacets = Schema.decodeUnknownOption(PackageFacets)

const FacetEnvelope = Schema.Struct({
  default: Schema.optional(Schema.Unknown),
  plugin: Schema.optional(Schema.Unknown),
})
const decodeEnvelope = Schema.decodeUnknownOption(FacetEnvelope)

const PluginRecord = Schema.Struct({
  id: Schema.String,
  provides: Schema.Array(Schema.Unknown),
})
const decodePluginRecord = Schema.decodeUnknownOption(PluginRecord)

const ContributionValue = Schema.Struct({
  value: Schema.Unknown,
})
const decodeContributionValue = Schema.decodeUnknownOption(ContributionValue)

const UiPair = Schema.Struct({
  slot: Schema.String,
  defId: Schema.String,
})
const decodeUiPair = Schema.decodeUnknownOption(UiPair)

const UiDefsExport = Schema.Struct({
  defs: Schema.Array(Schema.Unknown),
})
const decodeUiDefsExport = Schema.decodeUnknownOption(UiDefsExport)

interface UiPair {
  readonly slot: string
  readonly defId: string
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: a raw contribution from an imported server facet; the pair schema below is the parse
const pairOfContribution = (provided: unknown): UiPair | undefined => {
  const wrapped = decodeContributionValue(provided)
  if (Option.isNone(wrapped)) return undefined
  const pair = decodeUiPair(wrapped.value.value)
  return Option.isSome(pair) ? { slot: pair.value.slot, defId: pair.value.defId } : undefined
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: a raw plugin record from an imported facet; the shape schema below is the parse
const pairsOfRecord = (record: unknown): readonly UiPair[] => {
  const decoded = decodePluginRecord(record)
  if (Option.isNone(decoded)) return []
  const pairs: UiPair[] = []
  for (const provided of decoded.value.provides) {
    const pair = pairOfContribution(provided)
    if (pair !== undefined) pairs.push(pair)
  }
  return pairs
}

const sortedPairs = (pairs: readonly UiPair[]): readonly UiPair[] =>
  [...pairs].sort(
    (left, right) => left.slot.localeCompare(right.slot) || left.defId.localeCompare(right.defId),
  )

/** The UI claims a server facet's plugin record declares, by importing it. */
const pairsOfServerEntry = async (entry: string): Promise<readonly UiPair[]> => {
  const loaded: unknown = await import(pathToFileURL(entry).href)
  const decoded = decodeEnvelope(loaded)
  if (Option.isNone(decoded)) {
    throw new FacetManifestError({ message: `server facet ${entry} exported no plugin` })
  }
  for (const record of [decoded.value.default, decoded.value.plugin]) {
    const pairs = pairsOfRecord(record)
    if (pairs.length > 0) return sortedPairs(pairs)
  }
  return []
}

/** The `defs` export of a UI facet entry, for a plugin with no server facet. */
const pairsOfUiEntry = async (entry: string): Promise<readonly UiPair[]> => {
  const loaded: unknown = await import(pathToFileURL(entry).href)
  const decoded = decodeUiDefsExport(loaded)
  if (Option.isNone(decoded)) return []
  const pairs: UiPair[] = []
  for (const def of decoded.value.defs) {
    const pair = decodeUiPair(def)
    if (Option.isSome(pair)) pairs.push({ slot: pair.value.slot, defId: pair.value.defId })
  }
  return sortedPairs(pairs)
}

export interface BuiltPluginFacets {
  readonly manifest: FacetManifest
  readonly manifestPath: string
}

/**
 * Build a plugin's facets to disk: the server facet through `buildFacet`,
 * the UI facet through `buildUiBundle` with its bytes written beside the
 * manifest, and `dist/facets.json` naming both. The UI definition ids come
 * from the server record's own claims, so the manifest describes what the
 * host's live join will match; a UI facet with no discoverable defs fails
 * the build loud rather than shipping a bundle the snapshot can never join.
 */
export const buildPluginFacets = async (packageDir: string): Promise<BuiltPluginFacets> => {
  const dir = resolve(packageDir)
  const raw: unknown = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  const decoded = decodePackageFacets(raw)
  if (Option.isNone(decoded)) {
    throw new FacetManifestError({ message: `package.json in ${dir} has no oru.facets` })
  }
  const facets = decoded.value.oru?.facets
  if (facets?.server === undefined && facets?.ui === undefined) {
    throw new FacetManifestError({ message: `package.json in ${dir} declares no facets` })
  }
  const outDir = join(dir, 'dist')
  const store = join(outDir, 'facets')
  await mkdir(store, { recursive: true })

  let server: FacetServerEntry | null = null
  let pairs: readonly UiPair[] = []
  if (facets?.server !== undefined) {
    const entry = join(dir, facets.server)
    const built = await buildFacet(entry, store)
    server = { address: built.address, file: relative(outDir, built.path) }
    pairs = await pairsOfServerEntry(entry)
  }

  const ui: FacetUiEntry[] = []
  if (facets?.ui !== undefined) {
    const entry = join(dir, facets.ui)
    if (pairs.length === 0) pairs = await pairsOfUiEntry(entry)
    if (pairs.length === 0) {
      throw new FacetManifestError({ message: `ui facet ${entry} contributes no defs` })
    }
    const bundle = await buildUiBundle(entry)
    const file = join('facets', `${bundle.address}.js`)
    await writeFile(join(outDir, file), bundle.js, 'utf8')
    const written = await readFile(join(outDir, file), 'utf8')
    if (addressOf(Buffer.from(written, 'utf8')) !== bundle.address) {
      throw new FacetManifestError({
        message: `ui facet ${entry} changed between bundle and write`,
      })
    }
    ui.push({
      address: bundle.address,
      file,
      defIds: pairs.map((pair) => pair.defId),
      slots: pairs.map((pair) => pair.slot),
    })
  }

  const manifest: FacetManifest = { server, ui }
  const manifestPath = join(outDir, 'facets.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { manifest, manifestPath }
}
