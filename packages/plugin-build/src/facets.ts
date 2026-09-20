import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Option, Schema } from 'effect'
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
 * bytes, so the address names the bytes the manifest points at.
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
      server: Schema.optional(Schema.String),
      ui: Schema.optional(Schema.String),
    }),
  ),
})
const decodePackageFacets = Schema.decodeUnknownOption(PackageFacets)

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

/** The UI claims a plugin makes: always the `defs` export of its ui entry. */
const pairsOfUiEntry = async (entry: string): Promise<readonly UiPair[]> => {
  const url = pathToFileURL(entry).href
  const pending: Promise<unknown> = import(url)
  const loaded: unknown = await pending
  // SAFETY: a ui entry exports its defs as a default export; the defs schema below is the parse
  const envelope = loaded as { readonly default?: unknown }
  const exported = envelope.default ?? loaded
  const decoded = decodeUiDefsExport(exported)
  if (Option.isNone(decoded)) return []
  const pairs: UiPair[] = []
  for (const def of decoded.value.defs) {
    const pair = decodeUiPair(def)
    if (Option.isSome(pair)) pairs.push({ slot: pair.value.slot, defId: pair.value.defId })
  }
  return [...pairs].sort(
    (left, right) => left.slot.localeCompare(right.slot) || left.defId.localeCompare(right.defId),
  )
}

export interface BuiltPluginFacets {
  readonly manifest: FacetManifest
  readonly manifestPath: string
}

/**
 * Build a plugin's facets to disk: the server facet for Node, the UI facet
 * for the browser with its bytes written beside the manifest, and
 * `dist/facets.json` naming both. The UI definition ids come from the ui
 * entry's own `defs`, so the manifest describes what the host's live join
 * will match; a UI facet with no discoverable defs fails the build loud
 * rather than shipping a bundle the snapshot can never join.
 */
export const buildPluginFacets = async (packageDir: string): Promise<BuiltPluginFacets> => {
  const dir = resolve(packageDir)
  const raw: unknown = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  const decoded = decodePackageFacets(raw)
  const facets = Option.isSome(decoded) ? decoded.value.oru : undefined
  if (facets?.server === undefined && facets?.ui === undefined) {
    throw new FacetManifestError({ message: `package.json in ${dir} declares no facets` })
  }
  const outDir = join(dir, 'dist')
  const store = join(outDir, 'facets')
  await mkdir(store, { recursive: true })

  let server: FacetServerEntry | null = null
  if (facets?.server !== undefined) {
    const entry = join(dir, facets.server)
    const built = await buildFacet(entry, store)
    server = { address: built.address, file: relative(outDir, built.path) }
  }

  const ui: FacetUiEntry[] = []
  if (facets?.ui !== undefined) {
    const entry = join(dir, facets.ui)
    const pairs = await pairsOfUiEntry(entry)
    if (pairs.length === 0) {
      throw new FacetManifestError({ message: `ui facet ${entry} contributes no defs` })
    }
    const bundle = await buildUiBundle(entry)
    const file = join('facets', `${bundle.address}.js`)
    await writeFile(join(outDir, file), bundle.js, 'utf8')
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
