import { Context, Effect } from 'effect'
import { contribute, definePlugin, provide } from '../../../src/index.ts'
import { facetEvents } from './events.ts'
import { Banner, Echo } from './tokens.ts'

export default definePlugin({
  id: 'facet-echo',
  provides: [provide(Echo), contribute(Banner, { text: 'gen-a' })],
  server: {
    setup: () =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            facetEvents.push('a:open')
          }),
          () =>
            Effect.sync(() => {
              facetEvents.push('a:close')
            }),
        )
        return Context.make(Echo, {
          echo: (value) => Effect.succeed(`a:${value}`),
        })
      }),
  },
})
