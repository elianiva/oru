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
    alwaysBundle: () => true,
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
