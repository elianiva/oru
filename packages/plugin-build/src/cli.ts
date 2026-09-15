#!/usr/bin/env node
import { buildFacet } from './build.ts'

const usage = 'usage: oru-build-facet <entry> [--store dir] [--external spec]'

interface CliFlags {
  readonly entry: string
  readonly store: string
  readonly externals: readonly string[]
}

const parse = (args: readonly string[]): CliFlags => {
  let entry: string | undefined
  let store = 'dist/facets'
  const externals: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--store') {
      const value = args[i + 1]
      if (value === undefined) throw new Error(usage)
      store = value
      i += 1
      continue
    }
    if (arg === '--external') {
      const value = args[i + 1]
      if (value === undefined) throw new Error(usage)
      externals.push(value)
      i += 1
      continue
    }
    if (arg !== undefined && arg.startsWith('-')) throw new Error(usage)
    if (entry !== undefined) throw new Error(usage)
    entry = arg
  }
  if (entry === undefined) throw new Error(usage)
  return { entry, store, externals }
}

try {
  const flags = parse(process.argv.slice(2))
  const built = await buildFacet(flags.entry, flags.store, flags.externals)
  process.stdout.write(`${built.address}\n`)
} catch (error) {
  const message = error instanceof Error ? error.message : usage
  process.stderr.write(`${message}\n`)
  process.exitCode = 2
}
