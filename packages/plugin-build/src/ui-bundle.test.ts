import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildUiBundle } from './ui-bundle.ts'

describe('buildUiBundle', () => {
  it('bundles a facet entry into one ESM document addressed by content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oru-ui-test-'))
    const entry = join(dir, 'facet.ts')
    await writeFile(entry, `export const defs = [{ slot: 'composer', defId: 'composer' }]\n`)
    const built = await buildUiBundle(entry)
    expect(built.address).toMatch(/^[0-9a-f]{64}$/)
    expect(built.js).toContain('composer')
    const rebuilt = await buildUiBundle(entry)
    expect(rebuilt.address).toBe(built.address)
  })
})
