import { Context, Effect } from 'effect'
import { definePlugin, provide } from '../../../src/index.ts'
import { facetEvents } from './events.ts'
import { Echo } from './tokens.ts'

export default definePlugin({
  id: 'facet-echo',
  provides: [provide(Echo)],
  server: {
    setup: () =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            facetEvents.push('b:open')
          }),
          () =>
            Effect.sync(() => {
              facetEvents.push('b:close')
            }),
        )
        return Context.make(Echo, {
          echo: (value) => Effect.succeed(`b:${value}`),
        })
      }),
  },
})
