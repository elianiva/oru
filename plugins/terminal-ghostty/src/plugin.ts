import { Effect } from 'effect'
import { definePlugin } from '@oru/kernel'
import { slot } from '@oru/ui'

/**
 * `oru/terminal-ghostty`, the panel terminal as an outsider plugin.
 *
 * Same shape as `oru/chat-ui`: the host loads this record through the
 * generic plugin-source loader and never imports it statically. `apply`
 * only claims the additive `panel` slot; the PTY backend lives in the
 * host (`POST /pty`, WS `/pty/:sessionId`, `@oru/pty` dialect) so future
 * panel-tab plugins reuse it. The code lives in the `ui` facet the host
 * bundles and serves, joined by plugin id.
 */
export const terminalGhosttyPlugin = definePlugin({
  id: 'oru/terminal-ghostty',
  panel: { title: 'Terminal' },
  apply: (ctx) =>
    Effect.gen(function* () {
      yield* slot(ctx, { slot: 'panel', defId: 'terminal', title: 'Terminal' })
    }),
})

export default terminalGhosttyPlugin
