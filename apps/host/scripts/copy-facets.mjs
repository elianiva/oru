import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const hostRoot = join(here, '..')
const repoRoot = join(hostRoot, '..', '..')
const target = join(hostRoot, 'dist', 'facets')

const stripScope = (name) => (name.startsWith('@') ? name.slice(1) : name)

rmSync(target, { recursive: true, force: true })

let copied = 0
for (const base of [join(repoRoot, 'plugins')]) {
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(base, entry.name)
    const manifestPath = join(dir, 'dist', 'facets.json')
    if (!existsSync(manifestPath)) continue
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const destination = join(target, stripScope(pkg.name))
    cpSync(manifestPath, join(destination, 'facets.json'))
    cpSync(join(dir, 'dist', 'facets'), join(destination, 'facets'), { recursive: true })
    copied += 1
  }
}

process.stdout.write(`copy-facets: ${copied} plugin(s) -> ${target}\n`)
