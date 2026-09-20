import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Effect, Fiber, Schema, Stream } from 'effect'
import { PluginReloadClient, ReloadFailed, UiClient, UnknownPlugin, clientsFor } from '@oru/rpc'
import { corePlugins, loadExternalPlugins, serveHost } from '../src/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const fixtureDir = join(repoRoot, 'plugins', 'reload-fixture')
const fixtureUiFile = join(fixtureDir, 'src', 'ui.ts')
const fixtureServerFile = join(fixtureDir, 'src', 'server.ts')

const SPECIFIER = '@oru/reload-fixture'
const PLUGIN = 'test/reload-fixture'

/** Boot against an empty facet store so every byte comes from source. */
const bootSourceHost = (facetsDir: string) =>
  Effect.gen(function* () {
    const external = yield* loadExternalPlugins([{ specifier: SPECIFIER }], () => {}, facetsDir)
    return yield* serveHost({
      plugins: [...corePlugins, ...external],
      hostname: '127.0.0.1',
      port: 0,
      ui: { sources: [{ specifier: SPECIFIER }], facetsDir },
    })
  })

const snapshotOf = (url: string) =>
  Effect.gen(function* () {
    const ui = yield* UiClient
    return yield* ui.snapshot()
  }).pipe(Effect.provide(clientsFor(url)))

const reloadOf = (url: string, specifier: string) =>
  Effect.gen(function* () {
    const reload = yield* PluginReloadClient
    return yield* reload.reload(specifier)
  }).pipe(Effect.provide(clientsFor(url)))

const bodyOf = (url: string, jsUrl: string) =>
  Effect.promise(() => fetch(`${url}${jsUrl}`).then((response) => response.text()))

describe('plugin reload', () => {
  it('reloads new bytes to a new address while the old address still serves', async () => {
    const facetsDir = mkdtempSync(join(tmpdir(), 'oru-reload-'))
    const uiSource = readFileSync(fixtureUiFile, 'utf8')
    try {
      const seen = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const running = yield* bootSourceHost(facetsDir)
            const before = yield* snapshotOf(running.url)
            const firstAddress = before.bundles[0]?.address
            if (firstAddress === undefined) expect.fail('expected a bundle before reload')
            expect(before.assignments).toEqual([
              { slot: 'composer', plugin: PLUGIN, defId: 'widget' },
            ])
            const staleBefore = yield* bodyOf(running.url, `/ui/${firstAddress}.js`)

            const watching = yield* Effect.gen(function* () {
              const ui = yield* UiClient
              return yield* ui.watch.pipe(Stream.take(2), Stream.runCollect)
            }).pipe(Effect.provide(clientsFor(running.url)), Effect.forkScoped)

            writeFileSync(fixtureUiFile, `${uiSource}\nexport const reloadProbe: string = 'two'\n`)
            const reloaded = yield* reloadOf(running.url, PLUGIN)
            const secondAddress = reloaded.address
            if (secondAddress === undefined) expect.fail('expected an address after reload')
            expect(secondAddress).not.toBe(firstAddress)

            const after = yield* snapshotOf(running.url)
            expect(after.bundles[0]?.address).toBe(secondAddress)

            const emitted = yield* Fiber.join(watching)
            const addresses = [...emitted].map((snapshot) => snapshot.bundles[0]?.address)
            expect(addresses).toEqual([firstAddress, secondAddress])

            const fresh = yield* bodyOf(running.url, `/ui/${secondAddress}.js`)
            const stale = yield* bodyOf(running.url, `/ui/${firstAddress}.js`)
            return { fresh, stale, staleBefore }
          }),
        ),
      )
      expect(seen.fresh).toContain('reloadProbe')
      expect(seen.stale).toBe(seen.staleBefore)
    } finally {
      writeFileSync(fixtureUiFile, uiSource)
      rmSync(facetsDir, { recursive: true, force: true })
    }
  }, 180_000)

  it('keeps the old generation live when the rebuild fails, with a declared error', async () => {
    const facetsDir = mkdtempSync(join(tmpdir(), 'oru-reload-'))
    const serverSource = readFileSync(fixtureServerFile, 'utf8')
    try {
      const seen = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const running = yield* bootSourceHost(facetsDir)
            const before = yield* snapshotOf(running.url)
            const address = before.bundles[0]?.address
            if (address === undefined) expect.fail('expected a bundle before reload')
            const liveBefore = yield* bodyOf(running.url, `/ui/${address}.js`)

            writeFileSync(
              fixtureServerFile,
              serverSource.replace(
                "id: 'test/reload-fixture'",
                "id: 'test/reload-fixture-changed'",
              ),
            )
            const outcome = yield* reloadOf(running.url, PLUGIN).pipe(
              Effect.match({
                onFailure: (error) => ({ ok: false as const, error }),
                onSuccess: (result) => ({ ok: true as const, result }),
              }),
            )
            expect(outcome.ok).toBe(false)
            if (outcome.ok) expect.fail('expected the reload to fail')
            expect(Schema.is(ReloadFailed)(outcome.error)).toBe(true)

            const snapshot = yield* snapshotOf(running.url)
            expect(snapshot.bundles[0]?.address).toBe(address)
            const live = yield* bodyOf(running.url, `/ui/${address}.js`)
            return { live, liveBefore }
          }),
        ),
      )
      expect(seen.live).toBe(seen.liveBefore)
      expect(seen.live.length).toBeGreaterThan(0)
    } finally {
      writeFileSync(fixtureServerFile, serverSource)
      rmSync(facetsDir, { recursive: true, force: true })
    }
  }, 180_000)

  it('names the known plugins for an unknown specifier', async () => {
    const facetsDir = mkdtempSync(join(tmpdir(), 'oru-reload-'))
    try {
      const outcome = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const running = yield* bootSourceHost(facetsDir)
            return yield* reloadOf(running.url, 'oru/nope').pipe(
              Effect.match({
                onFailure: (error) => ({ ok: false as const, error }),
                onSuccess: (result) => ({ ok: true as const, result }),
              }),
            )
          }),
        ),
      )
      expect(outcome.ok).toBe(false)
      if (outcome.ok) expect.fail('expected the reload to fail')
      expect(Schema.is(UnknownPlugin)(outcome.error)).toBe(true)
      if (!Schema.is(UnknownPlugin)(outcome.error)) expect.fail('expected UnknownPlugin')
      expect(outcome.error.specifier).toBe('oru/nope')
      expect(outcome.error.known).toContain(PLUGIN)
    } finally {
      rmSync(facetsDir, { recursive: true, force: true })
    }
  }, 180_000)

  it('treats a same-bytes reload as a no-op on the address', async () => {
    const facetsDir = mkdtempSync(join(tmpdir(), 'oru-reload-'))
    try {
      const seen = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const running = yield* bootSourceHost(facetsDir)
            const before = yield* snapshotOf(running.url)
            const reloaded = yield* reloadOf(running.url, SPECIFIER)
            const after = yield* snapshotOf(running.url)
            return { before, reloaded, after }
          }),
        ),
      )
      const address = seen.before.bundles[0]?.address
      if (address === undefined) expect.fail('expected a bundle before reload')
      expect(seen.reloaded.address).toBe(address)
      expect(seen.after).toEqual(seen.before)
    } finally {
      rmSync(facetsDir, { recursive: true, force: true })
    }
  }, 180_000)
})
