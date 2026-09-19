import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
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
})
export type FacetUiEntry = typeof FacetUiEntry.Type

/**
 * What a plugin `build` leaves in `dist/facets.json`: the content address
 * and dist-relative path of its server facet (null when the plugin has no
 * server facet), plus one entry per UI facet. Files live beside the manifest
 * under `dist/facets/`. UI addresses reuse `addressOf`, so `/ui/<address>.js`
 * URLs are unchanged between source and prebuilt serving.
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

export interface BuiltPluginFacets {
  readonly manifest: FacetManifest
  readonly manifestPath: string
}

/**
 * Build a plugin's facets to disk: the server facet through `buildFacet`,
 * the UI facet through `buildUiBundle` with its bytes written beside the
 * manifest, and `dist/facets.json` naming both.
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
  await rm(store, { recursive: true, force: true })
  await mkdir(store, { recursive: true })

  let server: FacetServerEntry | null = null
  if (facets?.server !== undefined) {
    const built = await buildFacet(join(dir, facets.server), store)
    server = { address: built.address, file: relative(outDir, built.path) }
  }

  const ui: FacetUiEntry[] = []
  if (facets?.ui !== undefined) {
    const entry = join(dir, facets.ui)
    const bundle = await buildUiBundle(entry)
    const file = join('facets', `${bundle.address}.js`)
    await writeFile(join(outDir, file), bundle.js, 'utf8')
    const written = await readFile(join(outDir, file), 'utf8')
    if (addressOf(Buffer.from(written, 'utf8')) !== bundle.address) {
      throw new FacetManifestError({
        message: `ui facet ${entry} changed between bundle and write`,
      })
    }
    ui.push({ address: bundle.address, file })
  }

  const manifest: FacetManifest = { server, ui }
  const manifestPath = join(outDir, 'facets.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { manifest, manifestPath }
}
