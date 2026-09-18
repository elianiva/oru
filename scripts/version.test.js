import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { publishManifest } from './pack-host.mjs'
import { bumpPublicVersions, bumpSemver, lockstepError } from './version.mjs'

const fixtureRoot = (tree) => {
  const root = mkdtempSync(join(tmpdir(), 'oru-version-'))
  for (const [rel, body] of Object.entries(tree)) {
    const file = join(root, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`)
  }
  return root
}

const workspace = (overrides) => ({
  'package.json': { name: 'oru', private: true },
  'apps/host/package.json': { name: '@oru/host', version: '0.0.0', private: true },
  'packages/kernel/package.json': { name: '@oru/kernel', version: '0.0.0', private: true },
  'packages/harness/package.json': { name: '@oru/harness', version: '0.0.0', private: true },
  'packages/rpc/package.json': { name: '@oru/rpc', version: '0.0.0', private: true },
  'plugins/inference/package.json': { name: '@oru/inference', version: '0.0.0', private: true },
  'plugins/harness-pi/package.json': { name: '@oru/harness-pi', version: '0.0.0', private: true },
  'plugins/harness-registry/package.json': {
    name: '@oru/harness-registry',
    version: '0.0.0',
    private: true,
  },
  'apps/oru/package.json': { name: 'oru', version: '0.0.0', private: true },
  ...overrides,
})

void test('bumpSemver advances one of major, minor, or patch and zeros the rest', () => {
  assert.equal(bumpSemver('1.2.3', 'major'), '2.0.0')
  assert.equal(bumpSemver('1.2.3', 'minor'), '1.3.0')
  assert.equal(bumpSemver('1.2.3', 'patch'), '1.2.4')
})

void test('lockstep accepts one public host version while the kernel stays private', () => {
  const root = fixtureRoot(workspace())
  assert.equal(lockstepError(root), undefined)
  rmSync(root, { recursive: true, force: true })
})

void test('lockstep rejects two public manifests that do not share a version', () => {
  const root = fixtureRoot(
    workspace({
      'apps/host/package.json': { name: '@oru/host', version: '0.1.0', private: true },
      'apps/desktop/package.json': { name: '@oru/desktop', version: '0.2.0', private: true },
    }),
  )
  assert.match(
    lockstepError(root, ['apps/host/package.json', 'apps/desktop/package.json']),
    /disagree/,
  )
  rmSync(root, { recursive: true, force: true })
})

void test('lockstep rejects a workspace package that is no longer private', () => {
  const root = fixtureRoot(
    workspace({
      'packages/kernel/package.json': { name: '@oru/kernel', version: '0.0.0', private: false },
    }),
  )
  assert.match(lockstepError(root), /packages\/kernel\/package\.json/)
  rmSync(root, { recursive: true, force: true })
})

void test('bumpPublicVersions writes the next version only onto the host manifest', () => {
  const root = fixtureRoot(workspace())
  assert.deepEqual(bumpPublicVersions(root, 'patch'), { from: '0.0.0', to: '0.0.1' })
  assert.equal(
    JSON.parse(readFileSync(join(root, 'apps/host/package.json'), 'utf8')).version,
    '0.0.1',
  )
  assert.equal(
    JSON.parse(readFileSync(join(root, 'packages/kernel/package.json'), 'utf8')).version,
    '0.0.0',
  )
  rmSync(root, { recursive: true, force: true })
})

void test('publishManifest points entrypoints at dist and does not publish workspace packages', () => {
  const published = publishManifest({
    name: '@oru/host',
    version: '0.0.0',
    license: 'MIT',
  })
  assert.equal(published.main, './dist/index.js')
  assert.deepEqual(published.exports, { '.': './dist/index.js' })
  assert.deepEqual(published.bin, { 'oru-host': './dist/oru-host.js' })
  assert.deepEqual(published.files, ['dist', 'LICENSE'])
  assert.equal(published.dependencies, undefined)
  const json = JSON.stringify(published)
  assert.equal(json.includes('src/'), false)
  assert.equal(json.includes('workspace:'), false)
  assert.equal(json.includes('@oru/kernel'), false)
})
