import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { addressOf, buildFacet } from '../src/index.ts'

const fixture = fileURLToPath(new URL('./fixtures/echo.ts', import.meta.url))

describe('buildFacet', () => {
  it('gives the same address when the same source is built twice', async () => {
    const store = await mkdtemp(join(tmpdir(), 'oru-facet-'))
    const first = await buildFacet(fixture, store)
    const second = await buildFacet(fixture, store)
    expect(first.address).toBe(second.address)
    expect(first.address).toBe(addressOf(await readFile(first.path)))
    expect(first.address).toMatch(/^[0-9a-f]{64}$/)
  })

  it('gives a different address when the source changes', async () => {
    const store = await mkdtemp(join(tmpdir(), 'oru-facet-'))
    const before = await buildFacet(fixture, store)
    const copy = join(store, 'echo-changed.ts')
    await writeFile(copy, `${await readFile(fixture, 'utf8')}\nexport const extra = 1\n`)
    const after = await buildFacet(copy, store)
    expect(after.address).not.toBe(before.address)
    expect(after.address).toMatch(/^[0-9a-f]{64}$/)
  })
})
