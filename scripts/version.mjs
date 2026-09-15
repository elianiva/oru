import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

export const PUBLIC_MANIFESTS = ['apps/host/package.json']

const WORKSPACE_DIRS = ['packages', 'plugins', 'apps']

export const bumpKinds = new Set(['major', 'minor', 'patch'])

export const bumpSemver = (version, kind) => {
  if (!bumpKinds.has(kind)) throw new Error(`bump kind must be major, minor, or patch, got ${kind}`)
  const parts = version.split('.').map((piece) => Number(piece))
  if (parts.length !== 3 || parts.some((piece) => !Number.isInteger(piece) || piece < 0)) {
    throw new Error(`${version} is not a major.minor.patch version`)
  }
  const [major, minor, patch] = parts
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

export const workspaceManifestPaths = (root) => {
  const files = [join(root, 'package.json')]
  for (const dir of WORKSPACE_DIRS) {
    const base = join(root, dir)
    if (!existsSync(base)) continue
    for (const name of readdirSync(base)) {
      const file = join(base, name, 'package.json')
      if (existsSync(file)) files.push(file)
    }
  }
  return files
}

export const lockstepError = (root, publicManifests = PUBLIC_MANIFESTS) => {
  const versions = publicManifests.map((rel) => {
    const file = join(root, rel)
    return { rel, version: readJson(file).version }
  })
  const unique = new Set(versions.map((entry) => entry.version))
  if (unique.size !== 1) {
    return `user-visible versions disagree: ${versions.map((entry) => `${entry.rel}=${entry.version}`).join(', ')}`
  }

  for (const file of workspaceManifestPaths(root)) {
    const manifest = readJson(file)
    const rel = relative(root, file)
    if (manifest.private === false && !publicManifests.includes(rel)) {
      return `${rel} is not private. ADR-0008 keeps unpublished packages private, and ${publicManifests.join(', ')} is the published set.`
    }
  }
  return undefined
}

export const bumpPublicVersions = (root, kind, publicManifests = PUBLIC_MANIFESTS) => {
  const broken = lockstepError(root, publicManifests)
  if (broken !== undefined) throw new Error(broken)
  const first = publicManifests[0]
  if (first === undefined) throw new Error('PUBLIC_MANIFESTS is empty')
  const current = readJson(join(root, first)).version
  const next = bumpSemver(current, kind)
  for (const rel of publicManifests) {
    const file = join(root, rel)
    const manifest = readJson(file)
    manifest.version = next
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  return { from: current, to: next }
}
