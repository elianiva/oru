import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import { build } from 'tsdown'
import { addressOf } from './address.ts'

export class UiBundleError extends Schema.TaggedError<UiBundleError>()('UiBundleError', {
  message: Schema.String,
}) {}

export interface BuiltUiBundle {
  readonly address: string
  readonly js: string
}

/**
 * Bundle a presentation facet entry into one self-contained ESM document.
 *
 * tsdown (not the server facet's esbuild path) because UI bundles target
 * the browser and the repo builds those with tsdown. Everything is bundled
 * in (noExternal matches every specifier), so the app can import the bundle
 * import map and no shared vendor chunks. That duplicates `effect` and
 * `foldkit` inside the bundle, which is sound only because the slot
 * boundary is plain data: props in, intent out, commands stay in root
 * (ADR-0020). A shared-runtime optimization is the recorded follow-up.
 */
export const buildUiBundle = async (entry: string): Promise<BuiltUiBundle> => {
  const outDir = await mkdtemp(join(tmpdir(), 'oru-ui-'))
  try {
    await build({
      entry,
      outDir,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      dts: false,
      sourcemap: false,
      minify: false,
      clean: true,
      report: false,
      logLevel: 'silent',
      treeshake: true,
      deps: { alwaysBundle: [/.*/], onlyBundle: false },
    })
    const names = await readdir(outDir)
    const file = names.find((name) => name.endsWith('.js'))
    if (file === undefined) {
      throw new UiBundleError({ message: `tsdown emitted no file for ${entry}` })
    }
    const js = await readFile(join(outDir, file), 'utf8')
    return { address: addressOf(Buffer.from(js, 'utf8')), js }
  } catch (error) {
    if (error instanceof UiBundleError) throw error
    throw new UiBundleError({
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}
