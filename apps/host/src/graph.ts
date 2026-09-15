import { Effect, Option } from 'effect'
import type { AnyPlugin, Host } from '@oru/kernel'
import { Inference } from '@oru/inference'
import type { ViewGraph } from '@oru/rpc'
import { decodePanelUi } from './panel.ts'

/**
 * The host's live graph, as the view sees it: the plugins that carry a panel,
 * and the service tokens a consumer can resolve right now.
 *
 * Reading it is what keeps the view a projection: nothing here is cached, so a
 * plugin that activates or deactivates is visible on the next read.
 */
export const viewGraphOf = (host: Host, plugins: readonly AnyPlugin[]): Effect.Effect<ViewGraph> =>
  Effect.gen(function* () {
    const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]))
    const graph = yield* host.graph
    const active = [...graph.active.keys()].flatMap((plugin) => {
      const ui = decodePanelUi(byId.get(plugin)?.ui)
      if (Option.isNone(ui)) return []
      return [{ plugin, title: ui.value.title }]
    })
    return {
      active,
      tokens: [...graph.providers.keys()],
      // The view asks whether a thread has something to run, not which plugin
      // provides it, so the host answers that question here.
      agent: graph.providers.has(Inference.key),
    }
  })
