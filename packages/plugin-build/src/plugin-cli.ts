#!/usr/bin/env node
import { FacetManifestError, buildPluginFacets } from './facets.ts'

const usage = 'usage: oru-build-plugin'

if (process.argv.slice(2).length > 0) {
  process.stderr.write(`${usage}\n`)
  process.exitCode = 2
} else {
  try {
    const built = await buildPluginFacets(process.cwd())
    process.stdout.write(`${built.manifestPath}\n`)
  } catch (error) {
    const message =
      error instanceof FacetManifestError
        ? error.message
        : error instanceof Error
          ? error.message
          : usage
    process.stderr.write(`${message}\n`)
    process.exitCode = 2
  }
}
