import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Schema } from 'effect'
import { build, type InlineConfig } from 'tsdown'
import { addressOf } from './address.ts'

export class BundleError extends Schema.TaggedError<BundleError>()('BundleError', {
  message: Schema.String,
}) {}

export interface BuiltBundle {
  readonly address: string
  readonly js: string
}

/**
 * The entry's enclosing package. tsdown annotates bundled modules with
 * paths relative to its working directory, so pinning it here keeps
 * a bundle byte-identical whatever the caller's cwd is.
 */
export const packageDirOf = (entry: string): string => {
  let dir = dirname(resolve(entry))
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return dirname(resolve(entry))
    dir = parent
  }
}

const readEmitted = async (outDir: string, entry: string): Promise<string> => {
  const names = await readdir(outDir)
  const file = names.find((name) => name.endsWith('.js') || name.endsWith('.mjs'))
  if (file === undefined) {
    throw new BundleError({ message: `tsdown emitted no file for ${entry}` })
  }
  return readFile(join(outDir, file), 'utf8')
}

export interface RelativeExternalPlugin {
  readonly name: string
  readonly resolveId: (
    id: string,
    importer: string | undefined,
  ) => { readonly id: string; readonly external: true } | undefined
}

/**
 * Bundle one facet entry into a single ESM document with tsdown, the only
 * bundler the repo uses. The server facet targets Node with bare packages
 * left external; the UI facet targets the browser with everything bundled
 * in, so the app can import the bundle without shared vendor chunks.
 */
export const bundleWithTsdown = async (
  entry: string,
  options: {
    readonly platform: 'node' | 'browser'
    readonly external?: readonly (string | RegExp)[] | undefined
    readonly plugins?: readonly RelativeExternalPlugin[] | undefined
    readonly alwaysBundle?: boolean | undefined
  },
): Promise<BuiltBundle> => {
  const absolute = resolve(entry)
  const outDir = await mkdtemp(join(tmpdir(), 'oru-bundle-'))
  const config: InlineConfig = {
    // Inline options only: never a config file from the caller's
    // directory, so a bundle built at plugin build time is byte-identical
    // to one built at startup, whatever either caller's cwd is.
    config: false,
    cwd: packageDirOf(absolute),
    entry: absolute,
    outDir,
    format: 'esm',
    platform: options.platform,
    target: 'es2022',
    dts: false,
    sourcemap: false,
    minify: false,
    clean: true,
    report: false,
    logLevel: 'silent',
    treeshake: true,
    external: [...(options.external ?? [])],
    plugins: [...(options.plugins ?? [])],
  }
  if (options.alwaysBundle === true) {
    config.deps = { alwaysBundle: [/.*/], onlyBundle: false }
  }
  try {
    await build(config)
    const js = await readEmitted(outDir, entry)
    return { address: addressOf(Buffer.from(js, 'utf8')), js }
  } catch (error) {
    if (error instanceof BundleError) throw error
    throw new BundleError({
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

/**
 * Keep relative specs shared across generations external by mapping them to
 * absolute file URLs, so two generations import one module identity. The
 * reload suite uses this for its shared events module.
 */
export const relativeExternalsPlugin = (
  entryDir: string,
  specs: readonly string[],
): RelativeExternalPlugin => {
  const byPath = new Map<string, string>()
  for (const spec of specs) {
    if (!spec.startsWith('.')) continue
    const abs = resolve(entryDir, spec)
    byPath.set(abs, pathToFileURL(abs).href)
  }
  return {
    name: 'oru-relative-externals',
    resolveId: (id, importer) => {
      if (!id.startsWith('.')) return undefined
      const href = byPath.get(resolve(importer === undefined ? entryDir : dirname(importer), id))
      if (href === undefined) return undefined
      return { id: href, external: true }
    },
  }
}
