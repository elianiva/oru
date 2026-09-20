import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Schema } from 'effect'
import { bundleWithTsdown, relativeExternalsPlugin } from './bundle.ts'

export class FacetBuildError extends Schema.TaggedError<FacetBuildError>()('FacetBuildError', {
  message: Schema.String,
}) {}

export interface BuiltFacet {
  readonly address: string
  readonly path: string
  readonly url: string
}

export const urlOf = (store: string, address: string): string =>
  pathToFileURL(join(store, `${address}.js`)).href

export const locateIn = (store: string): ((address: string) => string) => {
  return (address) => urlOf(store, address)
}

/**
 * Bundle a server facet entry for Node: bare packages stay external, the
 * way they did on the old esbuild path, and relative specs the caller
 * names stay external as absolute file URLs so generations share them.
 */
export const buildFacet = async (
  entry: string,
  store: string,
  externals: readonly string[] = [],
): Promise<BuiltFacet> => {
  const entryDir = dirname(resolve(entry))
  const packageExternals = externals.filter((spec) => !spec.startsWith('.'))
  try {
    const built = await bundleWithTsdown(entry, {
      platform: 'node',
      external: packageExternals,
      plugins: [relativeExternalsPlugin(entryDir, externals)],
    })
    const path = join(store, `${built.address}.js`)
    await mkdir(store, { recursive: true })
    await writeFile(path, built.js)
    return { address: built.address, path, url: pathToFileURL(path).href }
  } catch (error) {
    if (error instanceof FacetBuildError) throw error
    throw new FacetBuildError({
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
