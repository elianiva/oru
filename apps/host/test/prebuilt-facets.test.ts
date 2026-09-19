import './block-plugin-sources.mjs'
import { cpSync, existsSync, readFileSync } from 'node:fs'
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
  if (!existsSync(join(chatUiDist, 'facets.json'))) await buildPluginFacets(chatUiDir)
  const destination = join(hostFacetsRoot, 'oru', 'chat-ui')
  if (existsSync(join(destination, 'facets.json'))) return
  cpSync(join(chatUiDist, 'facets.json'), join(destination, 'facets.json'))
  cpSync(join(chatUiDist, 'facets'), join(destination, 'facets'), { recursive: true })
}

const snapshotAndBundles = (plugins: readonly AnyPlugin[], facetsDir: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const running = yield* serveHost({
        plugins,
        hostname: '127.0.0.1',
        port: 0,
        ui: { sources: [{ specifier: '@oru/chat-ui' }], facetsDir },
      })
      const snapshot = yield* Effect.gen(function* () {
        const ui = yield* UiClient
        return yield* ui.snapshot()
      }).pipe(Effect.provide(clientsFor(running.url)))
      const bodies: Array<{ status: number; body: string }> = []
      for (const bundle of snapshot.bundles) {
        const response = yield* Effect.promise(() => fetch(`${running.url}${bundle.jsUrl}`))
        bodies.push({
          status: response.status,
          body: yield* Effect.promise(() => response.text()),
        })
      }
      return { snapshot, bodies }
    }),
  )

describe('prebuilt facets', () => {
  it('boots a host from prebuilt facets alone, serving assignments and bundles', async () => {
    await ensureHostFacets()
    // Workspace plugin sources cannot resolve under this file's hook, so
    // every record and byte below comes from disk, the way the packed host
    // runs. This mirrors main.ts: external sources in, serving host out.
    const plugins = await Effect.runPromise(
      loadExternalPlugins([{ specifier: '@oru/chat-ui' }], () => {}, hostFacetsRoot),
    )
    expect(plugins.map((plugin) => plugin.id)).toEqual(['oru/chat-ui'])

    const seen = await Effect.runPromise(snapshotAndBundles(plugins, hostFacetsRoot))
    expect(seen.snapshot.assignments).toEqual([
      { slot: 'composer', plugin: 'oru/chat-ui', defId: 'composer' },
      { slot: 'conversation', plugin: 'oru/chat-ui', defId: 'conversation' },
    ])
    expect(seen.snapshot.bundles).toHaveLength(2)
    expect(seen.bodies).toHaveLength(2)
    seen.snapshot.bundles.forEach((bundle, index) => {
      expect(bundle.plugin).toBe('oru/chat-ui')
      expect(bundle.jsUrl).toBe(`/ui/${bundle.address}.js`)
      const diskJs = readFileSync(
        join(hostFacetsRoot, 'oru', 'chat-ui', 'facets', `${bundle.address}.js`),
        'utf8',
      )
      expect(seen.bodies[index]?.status).toBe(200)
      expect(seen.bodies[index]?.body).toBe(diskJs)
    })
  })
})
