import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Option, Schema } from 'effect'
import {
  addressOf,
  decodeFacetManifest,
  type FacetManifest,
  type FacetUiEntry,
} from '@oru/plugin-build'
import type { AnyPlugin } from '@oru/kernel'

const PrebuiltEnvelope = Schema.Struct({
  default: Schema.optional(Schema.Unknown),
  plugin: Schema.optional(Schema.Unknown),
})
const decodeEnvelope = Schema.decodeUnknownOption(PrebuiltEnvelope)

const PrebuiltIdentity = Schema.Struct({ id: Schema.String })
const decodeIdentity = Schema.decodeUnknownOption(PrebuiltIdentity)

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: a raw record from an imported prebuilt facet; the identity schema below is the parse
const isPluginRecord = (value: unknown): value is AnyPlugin => Option.isSome(decodeIdentity(value))

/**
 * The prebuilt facet store: `dist/facets` under the host package, whether
 * this module runs from `src` (source dev, after a build) or from `dist`
 * (a built or packed host). Both layouts walk up to the same package root,
 * so one resolution serves every way the host boots.
 */
export const defaultFacetsRoot = (): string => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return join(dir, 'dist', 'facets')
    const parent = dirname(dir)
    if (parent === dir) return join(dir, 'dist', 'facets')
    dir = parent
  }
}

const idPathOf = (specifier: string): string => specifier.replace(/^@/u, '')

/** A missing or unreadable manifest is not an error: the caller runs from source. */
export const readPrebuiltManifest = (
  specifier: string,
  facetsRoot: string,
): FacetManifest | undefined => {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(facetsRoot, idPathOf(specifier), 'facets.json'), 'utf8'),
    )
    const decoded = decodeFacetManifest(raw)
    return Option.isSome(decoded) ? decoded.value : undefined
  } catch {
    return undefined
  }
}

/** The file URL of a plugin's prebuilt server facet, when it is on disk. */
export const prebuiltServerUrl = (specifier: string, facetsRoot: string): string | undefined => {
  const manifest = readPrebuiltManifest(specifier, facetsRoot)
  if (manifest?.server === undefined || manifest.server === null) return undefined
  const path = join(facetsRoot, idPathOf(specifier), manifest.server.file)
  return existsSync(path) ? pathToFileURL(path).href : undefined
}

export interface PrebuiltUi {
  readonly entry: FacetUiEntry
  readonly js: string
}

/**
 * A plugin's prebuilt UI bundle bytes, verified against the manifest
 * address before they are trusted. Anything missing or mismatched resolves
 * to no prebuilt bundle, and the caller builds from source instead.
 */
export const readPrebuiltUi = (specifier: string, facetsRoot: string): PrebuiltUi | undefined => {
  const manifest = readPrebuiltManifest(specifier, facetsRoot)
  const entry = manifest?.ui[0]
  if (entry === undefined) return undefined
  try {
    const js = readFileSync(join(facetsRoot, idPathOf(specifier), entry.file), 'utf8')
    if (js.length === 0 || addressOf(Buffer.from(js, 'utf8')) !== entry.address) return undefined
    return { entry, js }
  } catch {
    return undefined
  }
}

/** A plugin record imported from its prebuilt server facet, without touching source. */
export const loadPrebuiltRecord = async (
  specifier: string,
  facetsRoot: string,
): Promise<AnyPlugin | undefined> => {
  const url = prebuiltServerUrl(specifier, facetsRoot)
  if (url === undefined) return undefined
  const decoded = decodeEnvelope(await import(/* @vite-ignore */ url).catch(() => undefined))
  if (Option.isNone(decoded)) return undefined
  for (const record of [decoded.value.default, decoded.value.plugin]) {
    if (isPluginRecord(record)) return record
  }
  return undefined
}
