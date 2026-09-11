import { Context, Effect } from 'effect'
import { definePlugin, provide } from '../../../src/index.ts'
import { Echo, type EchoService } from './tokens.ts'

export default definePlugin({
  id: 'facet-echo',
  provides: [provide(Echo)],
  server: {
    setup: () =>
      // SAFETY: this generation declares Echo but returns an empty context to fail cutover
      Effect.succeed(Context.empty() as Context.Context<EchoService>),
  },
})
