import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { addressOf } from './address.ts'
import { buildPluginFacets } from './facets.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixturePlugin = join(here, '..', 'test', 'fixture-plugin')
const fixtureServerOnly = join(here, '..', 'test', 'fixture-server-only')

describe('buildPluginFacets', () => {
  it('writes dist/facets.json with content-addressed server and ui artifacts', async () => {
    const built = await buildPluginFacets(fixturePlugin)

    expect(built.manifestPath).toBe(join(fixturePlugin, 'dist', 'facets.json'))
    expect(built.manifest.server).not.toBeNull()
    expect(built.manifest.server?.address).toMatch(/^[0-9a-f]{64}$/)
    expect(built.manifest.ui).toHaveLength(1)
    const ui = built.manifest.ui[0]
    if (ui === undefined) expect.fail('expected a ui facet entry')
    expect(ui.address).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.keys(ui).sort()).toEqual(['address', 'file'])
    for (const file of [built.manifest.server?.file, ui.file]) {
      const path = join(fixturePlugin, 'dist', file ?? '')
      expect(existsSync(path)).toBe(true)
      const bytes = await readFile(path)
      expect(addressOf(bytes)).toBe(file === ui.file ? ui.address : built.manifest.server?.address)
    }
    const onDisk: unknown = JSON.parse(await readFile(built.manifestPath, 'utf8'))
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(built.manifest)))
  })

  it('builds a server-only plugin with no ui entries', async () => {
    const built = await buildPluginFacets(fixtureServerOnly)

    expect(built.manifest.server).not.toBeNull()
    expect(built.manifest.ui).toEqual([])
  })

  it('fails loud when the package declares no facets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oru-facets-test-'))
    await writeFile(
      join(dir, 'package.json'),
      `${JSON.stringify({ name: 'fixture', type: 'module' })}\n`,
    )

    await expect(buildPluginFacets(dir)).rejects.toThrow(/declares no facets/)
  })
})
