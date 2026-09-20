import { Effect } from 'effect'
import { definePlugin } from '@oru/kernel'
import { slot } from '@oru/ui'

/**
 * `oru/chat-ui`, the composer and the thread viewer as an outsider plugin.
 *
 * The same shape as `oru/harness-pi`: the host loads this record through
 * the generic plugin-source loader and never imports it statically. It has
 * no services to provide, so `apply` only claims its slots; the code lives
 * in the `ui` facet the host bundles and serves, and the claims join to it
 * by plugin id.
 */
export const chatUiPlugin = definePlugin({
  id: 'oru/chat-ui',
  apply: (ctx) =>
    Effect.gen(function* () {
      yield* slot(ctx, { slot: 'composer', defId: 'composer', title: 'Composer' })
      yield* slot(ctx, { slot: 'conversation', defId: 'conversation', title: 'Conversation' })
    }),
})

export default chatUiPlugin
