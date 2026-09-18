const REQUIRED_IMPORTERS = ['packages/kernel', 'packages/harness', 'plugins/inference']

const REQUIRED_PACKAGES = [
  '@effect-uai/core',
  '@foldkit/devtools',
  '@foldkit/ui',
  '@foldkit/vite-plugin',
  'foldkit',
]

export const collectEffectPins = (lockfileText) => {
  const doc = lastYamlDocument(lockfileText)
  const pins = []
  const seen = new Set()
  const add = (consumer, version) => {
    const id = `${consumer}\0${version}`
    if (seen.has(id)) return
    seen.add(id)
    pins.push({ consumer, version })
  }

  let section = null
  let importer = null
  let inEffectDep = false

  for (const line of doc.split('\n')) {
    if (line === 'importers:') {
      section = 'importers'
      importer = null
      inEffectDep = false
      continue
    }
    if (line === 'packages:' || line === 'snapshots:') {
      section = 'keys'
      importer = null
      inEffectDep = false
      continue
    }

    if (section === 'keys') {
      const key = snapshotKey(line)
      if (key) {
        const pin = pinFromSnapshotKey(key)
        if (pin) add(pin.consumer, pin.version)
      }
      continue
    }

    if (section !== 'importers') continue

    const header = line.match(/^ {2}([^ \n][^:]*):$/)
    if (header) {
      importer = header[1]
      inEffectDep = false
      continue
    }
    if (importer && line === '      effect:') {
      inEffectDep = true
      continue
    }
    if (!inEffectDep) continue
    const version = line.match(/^ {8}version: (\S+)$/)
    if (version) {
      add(importer, version[1])
      inEffectDep = false
      continue
    }
    if (/^ {6}\S/.test(line)) inEffectDep = false
  }

  return pins
}

export const evaluateEffectLockstep = (lockfileText) => {
  const pins = collectEffectPins(lockfileText)
  const foundImporters = new Set(
    pins.filter((pin) => REQUIRED_IMPORTERS.includes(pin.consumer)).map((pin) => pin.consumer),
  )
  const foundPackages = new Set()
  for (const pin of pins) {
    const name = packageNameFromKey(pin.consumer)
    if (name && REQUIRED_PACKAGES.includes(name)) foundPackages.add(name)
  }
  const missing = [
    ...REQUIRED_IMPORTERS.filter((id) => !foundImporters.has(id)),
    ...REQUIRED_PACKAGES.filter((id) => !foundPackages.has(id)),
  ]
  const byVersion = new Map()
  for (const pin of pins) {
    const group = byVersion.get(pin.version)
    if (group) group.push(pin)
    else byVersion.set(pin.version, [pin])
  }
  if (missing.length > 0 || byVersion.size !== 1) {
    return { kind: 'failed', missing, byVersion, pins }
  }
  return { kind: 'ok', version: [...byVersion.keys()][0], pins }
}

export const formatEffectLockstepFailure = (result) => {
  const lines = ['effect lockstep failed.']
  if (result.missing.length > 0) {
    lines.push('Missing from the lockfile:')
    for (const id of result.missing) lines.push(`  ${id}`)
  }
  if (result.byVersion.size !== 1) {
    lines.push('Multiple effect versions resolved:')
    for (const version of [...result.byVersion.keys()].sort((a, b) => a.localeCompare(b))) {
      lines.push(`  ${version}`)
      const consumers = result.byVersion
        .get(version)
        .map((pin) => pin.consumer)
        .sort((a, b) => a.localeCompare(b))
      for (const consumer of consumers) lines.push(`    ${consumer}`)
    }
  }
  return lines.join('\n')
}

export const checkEffectLockstep = (lockfileText) => {
  const result = evaluateEffectLockstep(lockfileText)
  if (result.kind === 'ok') return result
  throw new Error(formatEffectLockstepFailure(result))
}

const lastYamlDocument = (text) => {
  const parts = text.split(/^---\s*$/m)
  return parts[parts.length - 1] ?? text
}

const snapshotKey = (line) => {
  const quoted = line.match(/^ {2}'((?:\\'|[^'])*)':/)
  if (quoted) return quoted[1].replace(/\\'/g, "'")
  const unquoted = line.match(/^ {2}([^' \n][^:]*):(?:$| )/)
  return unquoted ? unquoted[1] : null
}

const packageNameFromKey = (key) => {
  if (REQUIRED_IMPORTERS.includes(key)) return null
  if (key.startsWith('effect@') && !key.includes('(')) return 'effect'
  if (key.startsWith('@')) {
    const at = key.indexOf('@', 1)
    return at === -1 ? key : key.slice(0, at)
  }
  const at = key.indexOf('@')
  return at === -1 ? key : key.slice(0, at)
}

const pinFromSnapshotKey = (key) => {
  if (key.startsWith('effect@') && !key.includes('(')) {
    return { consumer: key, version: key.slice('effect@'.length) }
  }
  const name = packageNameFromKey(key)
  if (!name || !REQUIRED_PACKAGES.includes(name)) return null
  const peer = key.match(/\(effect@([^)]+)\)/)
  if (!peer) return null
  return { consumer: key, version: peer[1] }
}

const runCli = async (lockfilePath) => {
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(lockfilePath, 'utf8')
  const result = evaluateEffectLockstep(text)
  if (result.kind === 'ok') return
  console.error(formatEffectLockstepFailure(result))
  process.exitCode = 1
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href
if (isMain) {
  const lockfilePath = process.argv[2]
  if (!lockfilePath) {
    console.error('usage: node scripts/effect-lockstep.mjs <pnpm-lock.yaml>')
    process.exitCode = 1
  } else {
    await runCli(lockfilePath)
  }
}
