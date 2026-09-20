import { Effect } from 'effect'
import { definePlugin } from '../../../src/index.ts'
import { facetEvents } from './events.ts'
import { Banner, Echo } from './tokens.ts'

export default definePlugin({
  id: 'facet-echo',
  apply: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.contribute(Banner.of({ text: 'gen-a' }))
      yield* ctx.provide(Echo, {
        echo: (value) => Effect.succeed(`a:${value}`),
      })
      yield* Effect.sync(() => {
        facetEvents.push('a:open')
      })
      yield* ctx.effect(
        Effect.sync(() => {
          facetEvents.push('a:close')
        }),
      )
    }),
})
