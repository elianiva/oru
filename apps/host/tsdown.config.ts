import { chmodSync, writeFileSync } from 'node:fs'
import { defineConfig, type UserConfig } from 'tsdown'

const shared = {
  platform: 'node',
  format: ['esm'],
  target: 'node26',
  sourcemap: true,
  dts: false,
  shims: true,
  fixedExtension: false,
  hash: false,
  deps: {
    // Everything bundles in except tsdown itself: it builds plugin facets
    // at runtime, and bundling it drags rolldown's native binding behind a
    // dynamic require no bundler can see. The packed host installs tsdown
    // from its manifest instead, so npm resolves the platform binding.
    alwaysBundle: (id) => id !== 'tsdown',
    onlyBundle: false,
  },
  outExtensions: () => ({ js: '.js' }),
  outputOptions: {
    codeSplitting: false,
    entryFileNames: '[name].js',
  },
} satisfies UserConfig

export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/index.ts' },
  },
  {
    ...shared,
    entry: { main: 'src/main.ts' },
    copy: ['../../plugins/harness-pi/src/pi/oru-pi-extension.mjs'],
    onSuccess() {
      writeFileSync('dist/oru-host.js', '#!/usr/bin/env node\nimport "./main.js"\n')
      chmodSync('dist/oru-host.js', 0o755)
    },
  },
])
