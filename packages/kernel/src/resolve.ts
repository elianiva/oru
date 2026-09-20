import { CoeffectsUnmet } from './errors.ts'
import type { AnyPlugin } from './plugin.ts'
import type { PluginId } from './primitives.ts'
import { serviceId } from './service.ts'

export interface Resolution {
  readonly order: readonly AnyPlugin[]
  readonly blocked: ReadonlyMap<PluginId, CoeffectsUnmet>
}

export const resolve = (
  plugins: readonly AnyPlugin[],
  baseline: ReadonlySet<string>,
): Resolution => {
  const byId = new Map<PluginId, AnyPlugin>()
  for (const plugin of plugins) {
    if (!byId.has(plugin.id)) byId.set(plugin.id, plugin)
  }
  const order = [...byId.values()]
  const blocked = new Map<PluginId, CoeffectsUnmet>()
  for (const plugin of byId.values()) {
    const missing = plugin.inject.flatMap((token) => {
      const key = serviceId(token)
      return baseline.has(key) ? [] : [key]
    })
    if (missing.length > 0)
      blocked.set(plugin.id, new CoeffectsUnmet({ plugin: plugin.id, missing }))
  }
  return { order, blocked }
}
