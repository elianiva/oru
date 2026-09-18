import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  checkEffectLockstep,
  evaluateEffectLockstep,
  formatEffectLockstepFailure,
} from './effect-lockstep.mjs'

const alignedLockfile = `lockfileVersion: '9.0'

importers:
  packages/harness:
    dependencies:
      '@effect-uai/core':
        specifier: 0.15.0
        version: 0.15.0(effect@4.0.0-rc.112)
      effect:
        specifier: 4.0.0-rc.112
        version: 4.0.0-rc.112
  packages/kernel:
    dependencies:
      effect:
        specifier: 4.0.0-rc.112
        version: 4.0.0-rc.112
  plugins/inference:
    dependencies:
      effect:
        specifier: 4.0.0-rc.112
        version: 4.0.0-rc.112

snapshots:
  '@effect-uai/core@0.15.0(effect@4.0.0-rc.112)':
    dependencies:
      effect: 4.0.0-rc.112
  '@foldkit/devtools@0.158.2(effect@4.0.0-rc.112)(foldkit@0.158.2(effect@4.0.0-rc.112))':
    dependencies:
      effect: 4.0.0-rc.112
  '@foldkit/ui@0.158.2(effect@4.0.0-rc.112)(foldkit@0.158.2(effect@4.0.0-rc.112))':
    dependencies:
      effect: 4.0.0-rc.112
  '@foldkit/vite-plugin@0.20.2(effect@4.0.0-rc.112)(foldkit@0.158.2(effect@4.0.0-rc.112))(vite@8.2.2)':
    dependencies:
      effect: 4.0.0-rc.112
  effect@4.0.0-rc.112: {}
  foldkit@0.158.2(effect@4.0.0-rc.112):
    dependencies:
      effect: 4.0.0-rc.112
`

const splitLockfile = alignedLockfile
  .replaceAll(
    "'@effect-uai/core@0.15.0(effect@4.0.0-rc.112)':",
    "'@effect-uai/core@0.15.0(effect@4.0.0-rc.109)':",
  )
  .replace(`  effect@4.0.0-rc.112: {}`, `  effect@4.0.0-rc.109: {}\n  effect@4.0.0-rc.112: {}`)

void test('aligned lockfile reports a single effect version', () => {
  const result = evaluateEffectLockstep(alignedLockfile)
  assert.equal(result.kind, 'ok')
  assert.equal(result.version, '4.0.0-rc.112')
})

void test('split lockfile names the package and each version', () => {
  const result = evaluateEffectLockstep(splitLockfile)
  assert.equal(result.kind, 'failed')
  const message = formatEffectLockstepFailure(result)
  assert.match(message, /4\.0\.0-rc\.109/)
  assert.match(message, /4\.0\.0-rc\.112/)
  assert.match(message, /@effect-uai\/core@0\.15\.0\(effect@4\.0\.0-rc\.109\)/)
  assert.match(message, /packages\/kernel/)
  assert.throws(() => checkEffectLockstep(splitLockfile), { message })
})

void test('missing Foldkit fails with the package name', () => {
  const withoutFoldkit = alignedLockfile
    .split('\n')
    .filter((line) => !line.includes('foldkit@') && !line.includes('@foldkit/'))
    .join('\n')
  const result = evaluateEffectLockstep(withoutFoldkit)
  assert.equal(result.kind, 'failed')
  const message = formatEffectLockstepFailure(result)
  assert.match(message, /foldkit/)
  assert.match(message, /@foldkit\/devtools/)
  assert.match(message, /@foldkit\/ui/)
  assert.match(message, /@foldkit\/vite-plugin/)
})

void test('workspace pnpm-lock.yaml is a single effect version', () => {
  const lockfilePath = fileURLToPath(new URL('../pnpm-lock.yaml', import.meta.url))
  const result = evaluateEffectLockstep(readFileSync(lockfilePath, 'utf8'))
  assert.equal(
    result.kind,
    'ok',
    result.kind === 'ok' ? undefined : formatEffectLockstepFailure(result),
  )
})
