/// <reference lib="dom" />
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Effect, Schema } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { buildFacet, locateIn } from '@oru/plugin-build'
import {
  SetupFailed,
  definePlugin,
  defineService,
  loadFacet,
  makeFacetLoader,
  makeHost,
  sessionLogLayer,
} from '../src/index.ts'
import { facetEvents } from './fixtures/reload/events.ts'
import { Banner, Echo } from './fixtures/reload/tokens.ts'

interface ReaderService {
  readonly ping: Effect.Effect<string>
}

const Reader = defineService<ReaderService>('oru/facet-reader')

const readerPlugin = definePlugin({
  id: 'facet-reader',
  inject: [Echo],
  apply: (ctx) =>
    Effect.gen(function* () {
      const echo = yield* Echo
      yield* ctx.provide(Reader, {
        ping: echo.echo('live'),
      })
    }),
})

const fixturePath = (file: string): string =>
  fileURLToPath(new URL(`./fixtures/reload/${file}`, import.meta.url))

const reloadExternals = ['./events.ts']

const withMemoryLog = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.scoped(effect).pipe(
    Effect.provide(sessionLogLayer),
    Effect.provide(EventJournal.layerMemory),
  )

describe('FacetLoader', () => {
  it('reloads a fixture generation, drops old contributions, and keeps captured facades live', async () => {
    facetEvents.length = 0
    const store = await mkdtemp(join(tmpdir(), 'oru-facet-'))
    const genA = await buildFacet(fixturePath('gen-a.ts'), store, reloadExternals)
    const genB = await buildFacet(fixturePath('gen-b.ts'), store, reloadExternals)
    const genBad = await buildFacet(fixturePath('gen-bad.ts'), store, reloadExternals)
    const urlOf = locateIn(store)

    await Effect.runPromise(
      withMemoryLog(
        Effect.gen(function* () {
          const host = yield* makeHost([readerPlugin])
          const loader = makeFacetLoader(host, urlOf)
          const echo = host.facade(Echo)

          yield* loader.reload(genA.address)

          const afterA = yield* host.graph
          expect(afterA.active.has('facet-echo')).toBe(true)
          expect(afterA.active.has('facet-reader')).toBe(true)
          expect(afterA.active.get('facet-echo')?.generation).toBe(genA.address)
          expect(yield* echo.echo('x')).toBe('a:x')
          expect((yield* host.contributions(Banner)).map((entry) => entry.value.text)).toEqual([
            'gen-a',
          ])
          expect(yield* (yield* host.service(Reader)).ping).toBe('a:live')
          expect(facetEvents).toEqual(['a:open'])

          yield* loader.reload(genB.address)

          const afterB = yield* host.graph
          expect(afterB.active.has('facet-echo')).toBe(true)
          expect(afterB.active.has('facet-reader')).toBe(true)
          expect(afterB.active.get('facet-echo')?.generation).toBe(genB.address)
          expect(yield* echo.echo('x')).toBe('b:x')
          expect(yield* (yield* host.service(Reader)).ping).toBe('b:live')
          expect(yield* host.contributions(Banner)).toEqual([])
          expect(facetEvents).toEqual(['a:open', 'b:open', 'a:close'])

          const error = yield* Effect.flip(loader.reload(genBad.address))
          expect(Schema.is(SetupFailed)(error)).toBe(true)
          if (Schema.is(SetupFailed)(error)) expect(error.plugin).toBe('facet-echo')
          expect(yield* echo.echo('x')).toBe('b:x')
          expect((yield* host.graph).active.get('facet-echo')?.generation).toBe(genB.address)
          expect(facetEvents).toEqual(['a:open', 'b:open', 'a:close'])
        }),
      ),
    )
  })

  it('derives the same generation identity on two hosts for one bundle', async () => {
    const store = await mkdtemp(join(tmpdir(), 'oru-facet-'))
    const built = await buildFacet(fixturePath('gen-b.ts'), store, reloadExternals)
    const urlOf = locateIn(store)

    await Effect.runPromise(
      withMemoryLog(
        Effect.gen(function* () {
          const first = yield* makeHost([])
          const second = yield* makeHost([])
          const pluginA = yield* loadFacet(built.address, urlOf)
          const pluginB = yield* loadFacet(built.address, urlOf)
          const activationA = yield* first.replace(pluginA, built.address)
          const activationB = yield* second.replace(pluginB, built.address)
          expect(activationA.generation).toBe(built.address)
          expect(activationB.generation).toBe(built.address)
          expect((yield* first.graph).active.get('facet-echo')?.generation).toBe(built.address)
          expect((yield* second.graph).active.get('facet-echo')?.generation).toBe(built.address)
        }),
      ),
    )
  })
})
