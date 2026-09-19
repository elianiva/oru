import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const hostRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostDist = join(hostRoot, 'dist')
const facetsRoot = join(hostDist, 'facets')

const packageDirOf = (specifier) => {
  const require = createRequire(join(hostRoot, 'package.json'))
  let dir = dirname(require.resolve(specifier))
  for (;;) {
    const parent = dirname(dir)
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      const raw = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (raw?.name === specifier) return dir
    }
    if (parent === dir) return undefined
    dir = parent
  }
}

const hostPkg = JSON.parse(readFileSync(join(hostRoot, 'package.json'), 'utf8'))
const specifiers = [
  ...Object.keys(hostPkg.dependencies ?? {}),
  ...Object.keys(hostPkg.devDependencies ?? {}),
].filter((name) => name.startsWith('@oru/'))

rmSync(facetsRoot, { recursive: true, force: true })
let copied = 0
for (const specifier of specifiers) {
  let dir
  try {
    dir = packageDirOf(specifier)
  } catch {
    continue
  }
  if (dir === undefined) continue
  if (!existsSync(join(dir, 'dist', 'facets.json'))) continue
  const id = specifier.startsWith('@') ? specifier.slice(1) : specifier
  cpSync(join(dir, 'dist'), join(facetsRoot, id), { recursive: true })
  copied += 1
}
process.stdout.write(`copy-facets: ${copied} plugin facet stores into ${facetsRoot}\n`)
