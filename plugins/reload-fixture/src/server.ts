import { definePlugin } from '@oru/kernel'
import { slot } from '@oru/ui'

/**
 * The reload suite's own plugin: the only source the reload tests mutate,
 * so their edits never race another suite building a shared plugin.
 */
export const reloadFixturePlugin = definePlugin({
  id: 'test/reload-fixture',
  apply: (ctx) => slot(ctx, { slot: 'composer', defId: 'widget' }),
})

export default reloadFixturePlugin
