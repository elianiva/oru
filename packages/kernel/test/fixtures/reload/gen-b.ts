import { Effect } from 'effect'
import { definePlugin } from '../../../src/index.ts'
import { facetEvents } from './events.ts'
import { Echo } from './tokens.ts'

export default definePlugin({
  id: 'facet-echo',
  apply: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.provide(Echo, {
        echo: (value) => Effect.succeed(`b:${value}`),
      })
      yield* Effect.sync(() => {
        facetEvents.push('b:open')
      })
      yield* ctx.effect(
        Effect.sync(() => {
          facetEvents.push('b:close')
        }),
      )
    }),
})
