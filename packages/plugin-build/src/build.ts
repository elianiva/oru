import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import { addressOf } from './address.ts'

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

const relativeExternalsPlugin = (entryDir: string, specs: readonly string[]): esbuild.Plugin => {
  const byPath = new Map<string, string>()
  for (const spec of specs) {
    if (!spec.startsWith('.')) continue
    const abs = resolve(entryDir, spec)
    byPath.set(abs, pathToFileURL(abs).href)
  }
  return {
    name: 'relative-externals',
    setup(build) {
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        const href = byPath.get(resolve(args.resolveDir, args.path))
        if (href === undefined) return
        return { path: href, external: true }
      })
    },
  }
}

export const buildFacet = async (
  entry: string,
  store: string,
  externals: readonly string[] = [],
): Promise<BuiltFacet> => {
  const entryDir = dirname(resolve(entry))
  const packageExternals = externals.filter((spec) => !spec.startsWith('.'))
  const result = await esbuild.build({
    absWorkingDir: process.cwd(),
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    legalComments: 'none',
    sourcemap: false,
    logLevel: 'silent',
    packages: 'external',
    external: packageExternals,
    plugins: [relativeExternalsPlugin(entryDir, externals)],
  })
  const file = result.outputFiles[0]
  if (file === undefined) {
    throw new Error(`esbuild emitted no file for ${entry}`)
  }
  const address = addressOf(file.contents)
  const path = join(store, `${address}.js`)
  await mkdir(store, { recursive: true })
  await writeFile(path, file.contents)
  return { address, path, url: pathToFileURL(path).href }
}
