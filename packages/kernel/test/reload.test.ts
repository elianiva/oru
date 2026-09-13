/// <reference lib="dom" />
import { describe, expect, it } from 'vitest'
import { Context, Effect, Result } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import {
  DeclarationMismatch,
  ServiceMissing,
  definePlugin,
  defineService,
  makeFacetLoader,
  makeHost,
  serviceFacade,
} from '../src/index.ts'
import { facetEvents } from './fixtures/reload/events.ts'
import { Banner, Echo } from './fixtures/reload/tokens.ts'

interface ReaderService {
  readonly ping: Effect.Effect<string>
}

const Reader = defineService<ReaderService>('oru/facet-reader')

const readerPlugin = definePlugin({
  id: 'facet-reader',
  needs: [Echo],
  provides: [Reader],
  server: {
    setup: (ctx) => {
      const echo = ctx.service(Echo)
      return Effect.succeed(
        Context.make(Reader, {
          ping: echo.echo('live'),
        }),
      )
    },
  },
})

const fixtureUrl = (file: string): string =>
  new URL(`./fixtures/reload/${file}`, import.meta.url).href

describe('FacetLoader', () => {
  it('reloads a fixture generation, drops old contributions, and keeps captured facades live', async () => {
    facetEvents.length = 0
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([readerPlugin])
          const loader = makeFacetLoader(host)
          const echo = serviceFacade(host.service(Echo))

          yield* loader.reload(fixtureUrl('gen-a.ts'))

          const afterA = yield* host.graph
          expect(afterA.active.has('facet-echo')).toBe(true)
          expect(afterA.active.has('facet-reader')).toBe(true)
          expect(yield* echo.echo('x')).toBe('a:x')
          expect((yield* host.contributions(Banner)).map((entry) => entry.value.text)).toEqual([
            'gen-a',
          ])
          expect(yield* (yield* host.service(Reader)).ping).toBe('a:live')
          expect(facetEvents).toEqual(['a:open'])

          yield* loader.reload(fixtureUrl('gen-b.ts'))

          const afterB = yield* host.graph
          expect(afterB.active.has('facet-echo')).toBe(true)
          expect(afterB.active.has('facet-reader')).toBe(true)
          expect(yield* echo.echo('x')).toBe('b:x')
          expect(yield* (yield* host.service(Reader)).ping).toBe('b:live')
          expect(yield* host.contributions(Banner)).toEqual([])
          expect(facetEvents).toEqual(['a:open', 'b:open', 'a:close'])

          const failed = yield* Effect.result(loader.reload(fixtureUrl('gen-bad.ts')))
          expect(failed).toEqual(
            Result.fail(
              new DeclarationMismatch({
                plugin: 'facet-echo',
                problems: [ServiceMissing.make({ token: 'oru/facet-echo' })],
              }),
            ),
          )
          expect(yield* echo.echo('x')).toBe('b:x')
          expect(facetEvents).toEqual(['a:open', 'b:open', 'a:close'])
        }),
      ).pipe(Effect.provide(EventJournal.layerMemory)),
    )
  })
})
