import { bumpKinds, bumpPublicVersions, repoRoot } from './version.mjs'

const kind = process.argv[2]
if (kind === undefined || process.argv.length !== 3 || !bumpKinds.has(kind)) {
  process.stderr.write('Usage: node scripts/bump-version.mjs <major|minor|patch>\n')
  process.exitCode = 2
} else {
  const result = bumpPublicVersions(repoRoot, kind)
  process.stdout.write(`version ${result.from} -> ${result.to}\n`)
}
