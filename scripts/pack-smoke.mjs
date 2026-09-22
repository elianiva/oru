import { mkdtempSync, rmSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pack } from './pack-host.mjs'

const fail = (message) => {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const run = (command, args, options) => {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(' ')} exited ${String(result.status)}\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    )
  }
  return result
}

const listTarball = (file) =>
  run('tar', ['-tzf', file])
    .stdout.split('\n')
    .filter((line) => line.length > 0)

const startedHost = (bin, args, env) => {
  const settled = Promise.withResolvers()
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env })
  let output = ''
  const onData = (chunk) => {
    output += chunk
    const match = /listening on (http:\/\/\S+)/u.exec(output)
    if (match?.[1] !== undefined) {
      settled.resolve({ url: match[1], child, output })
    }
  }
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  child.on('error', (cause) => settled.reject(cause))
  child.on('close', (code) => {
    settled.reject(new Error(`the packed host exited ${String(code)} before listening:\n${output}`))
  })
  return settled.promise
}

const stop = (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  const settled = Promise.withResolvers()
  const killer = setTimeout(() => child.kill('SIGKILL'), 10_000)
  child.once('close', () => {
    clearTimeout(killer)
    settled.resolve()
  })
  child.kill('SIGTERM')
  return settled.promise
}

const tarball = pack()
const entries = listTarball(tarball)
const sourceTs = entries.filter((entry) => /\/src\/.*\.ts$/u.test(entry))
if (sourceTs.length > 0) fail(`packed tarball contains TypeScript source: ${sourceTs.join(', ')}`)
if (!entries.some((entry) => entry.endsWith('/dist/oru-host.js')))
  fail('packed tarball is missing dist/oru-host.js')
if (!entries.some((entry) => entry.endsWith('/dist/main.js')))
  fail('packed tarball is missing dist/main.js')
if (!entries.some((entry) => entry.endsWith('/dist/index.js')))
  fail('packed tarball is missing dist/index.js')
if (!entries.some((entry) => entry.endsWith('/dist/oru-pi-extension.mjs')))
  fail('packed tarball is missing dist/oru-pi-extension.mjs')

// The packed host serves its UI from prebuilt facets, so the tarball must
// carry each facet manifest plus every artifact the manifest names. A
// manifest without its bytes is the stale-dist failure this graph exists
// to prevent.
for (const id of [
  'oru/chat-ui',
  'oru/harness-pi',
  'oru/harness-claude-code',
  'oru/harness-opencode',
]) {
  const facetManifestEntry = entries.find((entry) =>
    entry.endsWith(`/dist/facets/${id}/facets.json`),
  )
  if (facetManifestEntry === undefined)
    fail(`packed tarball is missing dist/facets/${id}/facets.json`)
  const facetManifest = JSON.parse(run('tar', ['-xOzf', tarball, facetManifestEntry]).stdout)
  const facetFiles = [
    ...(facetManifest.server === null ? [] : [facetManifest.server.file]),
    ...facetManifest.ui.map((entry) => entry.file),
  ]
  if (facetFiles.length === 0) fail(`packed ${id} facets.json lists no artifacts`)
  for (const file of facetFiles) {
    if (!entries.some((entry) => entry.endsWith(`/dist/facets/${id}/${file}`)))
      fail(`packed tarball is missing dist/facets/${id}/${file}`)
  }
}

const prefix = mkdtempSync(join(tmpdir(), 'oru-host-smoke-'))
try {
  run('npm', ['init', '-y'], { cwd: prefix })
  run('npm', ['install', tarball], { cwd: prefix, stdio: 'inherit' })
  const bin = join(prefix, 'node_modules/.bin/oru-host')
  const version = run(bin, ['--version'], { env: process.env })
  if (version.stdout.trim() === '') fail('packed oru-host --version printed nothing')
  const journalDir = mkdtempSync(join(tmpdir(), 'oru-host-smoke-journal-'))
  const host = await startedHost(bin, ['--port', '0'], {
    ...process.env,
    ORU_JOURNAL: join(journalDir, 'oru.db'),
  })
  if (!host.url.startsWith('http://')) fail(`packed host did not listen: ${host.output}`)
  await stop(host.child)
  rmSync(journalDir, { recursive: true, force: true })
  process.stdout.write(`pack-smoke ok ${tarball} version ${version.stdout.trim()} ${host.url}\n`)
} finally {
  rmSync(prefix, { recursive: true, force: true })
}
