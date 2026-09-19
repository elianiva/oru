import { definePlugin, type AnyPlugin } from '@oru/kernel'
import { UiKind } from '@oru/ui'

/**
 * `oru/chat-ui`, the composer and the thread viewer as an outsider plugin.
 *
 * The same shape as `oru/harness-pi`: the host loads this record through
 * the generic plugin-source loader and never imports it statically. There
 * is no server facet — static `provides` publish the slot claims the way
 * `tools/echo` publishes its tool — and the code lives in the `ui` facet
 * the host bundles and serves for presentation facets to import.
 */
export const chatUiPlugin: AnyPlugin = definePlugin({
  id: 'oru/chat-ui',
  provides: [
    UiKind.of({ slot: 'composer', defId: 'composer', title: 'Composer' }),
    UiKind.of({ slot: 'conversation', defId: 'conversation', title: 'Conversation' }),
  ],
})

/** The record the generic plugin-source loader reads. */
export const plugin: AnyPlugin = chatUiPlugin

export default chatUiPlugin
