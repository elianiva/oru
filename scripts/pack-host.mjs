import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoRoot } from './version.mjs'

const hostRoot = join(repoRoot, 'apps/host')

export const publishManifest = (hostPkg) => ({
  name: hostPkg.name,
  version: hostPkg.version,
  license: hostPkg.license ?? 'MIT',
  type: 'module',
  bin: { 'oru-host': './dist/oru-host.js' },
  main: './dist/index.js',
  exports: {
    '.': './dist/index.js',
  },
  files: ['dist', 'LICENSE'],
  publishConfig: { access: 'public' },
  engines: { node: '>=26' },
})

export const pack = () => {
  // Build the host closure, not just the host: plugins build before the
  // host so dist/facets carries their facets when the host copies them.
  // The path filter names apps/host by path because the web app's package
  // name (oru) collides with the root package name, so a bare name filter
  // would match the wrong package.
  const build = spawnSync('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=./apps/host...'], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  if (build.status !== 0) process.exit(build.status ?? 1)

  const hostPkg = JSON.parse(readFileSync(join(hostRoot, 'package.json'), 'utf8'))
  const staging = mkdtempSync(join(tmpdir(), 'oru-host-pack-'))
  try {
    writeFileSync(
      join(staging, 'package.json'),
      `${JSON.stringify(publishManifest(hostPkg), null, 2)}\n`,
    )
    cpSync(join(hostRoot, 'dist'), join(staging, 'dist'), { recursive: true })
    cpSync(join(repoRoot, 'LICENSE'), join(staging, 'LICENSE'))
    const packed = spawnSync('pnpm', ['pack', '--pack-destination', hostRoot], {
      cwd: staging,
      encoding: 'utf8',
    })
    if (packed.status !== 0) {
      process.stderr.write(packed.stdout ?? '')
      process.stderr.write(packed.stderr ?? '')
      process.exit(packed.status ?? 1)
    }
    const printed = packed.stdout.trim().split('\n').at(-1)
    if (printed === undefined || printed.length === 0) {
      process.stderr.write('pnpm pack printed no tarball path\n')
      process.exit(1)
    }
    const tarball = printed.startsWith('/') ? printed : join(hostRoot, printed)
    process.stdout.write(`${tarball}\n`)
    return tarball
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  pack()
}
