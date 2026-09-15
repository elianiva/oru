import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const hostRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const extensionSource = join(hostRoot, '../../plugins/harness-pi/src/pi/oru-pi-extension.mjs')

const shared = {
  absWorkingDir: hostRoot,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  sourcemap: true,
  banner: {
    js: `import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
`,
  },
}

await esbuild.build({
  ...shared,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
})

await esbuild.build({
  ...shared,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
})

mkdirSync(join(hostRoot, 'dist'), { recursive: true })
copyFileSync(extensionSource, join(hostRoot, 'dist/oru-pi-extension.mjs'))
writeFileSync(join(hostRoot, 'dist/oru-host.js'), '#!/usr/bin/env node\nimport "./main.js"\n')
chmodSync(join(hostRoot, 'dist/oru-host.js'), 0o755)
