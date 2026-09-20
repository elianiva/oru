import { cpSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { UiClient, clientsFor } from '@oru/rpc'
import { buildPluginFacets } from '@oru/plugin-build'
import type { AnyPlugin } from '@oru/kernel'
import { loadExternalPlugins, serveHost } from '../src/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const chatUiDir = join(repoRoot, 'plugins', 'chat-ui')
const chatUiDist = join(chatUiDir, 'dist')
const hostFacetsRoot = join(repoRoot, 'apps', 'host', 'dist', 'facets')

const ensureHostFacets = async (): Promise<void> => {
  // Always rebuild: a stale facets.json from an older bundler would serve
  // bytes the current manifest never names.
  await buildPluginFacets(chatUiDir)
  const destination = join(hostFacetsRoot, 'oru', 'chat-ui')
  rmSync(destination, { recursive: true, force: true })
  cpSync(join(chatUiDist, 'facets.json'), join(destination, 'facets.json'))
  cpSync(join(chatUiDist, 'facets'), join(destination, 'facets'), { recursive: true })
}

const snapshotOf = (plugins: readonly AnyPlugin[], facetsDir: string | undefined) =>
  Effect.scoped(
    Effect.gen(function* () {
      const running = yield* serveHost({
        plugins,
        hostname: '127.0.0.1',
        port: 0,
        ui:
          facetsDir === undefined
            ? { sources: [{ specifier: '@oru/chat-ui' }] }
            : { sources: [{ specifier: '@oru/chat-ui' }], facetsDir },
      })
      return yield* Effect.gen(function* () {
        const ui = yield* UiClient
        return yield* ui.snapshot()
      }).pipe(Effect.provide(clientsFor(running.url)))
    }),
  )

describe('prebuilt parity', () => {
  it('serves identical assignments and bundle addresses from source and from disk', async () => {
    await ensureHostFacets()
    const plugins = await Effect.runPromise(
      loadExternalPlugins([{ specifier: '@oru/chat-ui' }], () => {}, hostFacetsRoot),
    )

    const fromPrebuilt = await Effect.runPromise(snapshotOf(plugins, hostFacetsRoot))
    // An empty facets root holds no manifests, so this boot resolves the
    // record and bundles the ui facet from source, exactly as before.
    const fromSource = await Effect.runPromise(
      snapshotOf(plugins, mkdtempSync(join(tmpdir(), 'oru-empty-facets-'))),
    )

    expect(fromSource.assignments).toEqual(fromPrebuilt.assignments)
    expect(fromSource.assignments).toEqual([
      { slot: 'composer', plugin: 'oru/chat-ui', defId: 'composer' },
      { slot: 'conversation', plugin: 'oru/chat-ui', defId: 'conversation' },
    ])
    expect(fromSource.bundles.map((bundle) => bundle.address).sort()).toEqual(
      fromPrebuilt.bundles.map((bundle) => bundle.address).sort(),
    )
  })
})
