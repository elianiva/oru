import { Result } from 'effect'
import { serviceTokensOf } from './contribution.ts'
import { CoeffectsUnmet, DuplicateProvider, GraphCycle } from './errors.ts'
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
): Result.Result<Resolution, DuplicateProvider | GraphCycle> => {
  const byId = new Map<PluginId, AnyPlugin>()
  const providerIndex = new Map<string, PluginId>()

  for (const plugin of plugins) {
    if (byId.has(plugin.id)) continue
    byId.set(plugin.id, plugin)
    for (const token of serviceTokensOf(plugin.provides)) {
      const key = serviceId(token)
      const existing = providerIndex.get(key)
      if (existing !== undefined && existing !== plugin.id) {
        return Result.fail(new DuplicateProvider({ token: key, existing, incoming: plugin.id }))
      }
      providerIndex.set(key, plugin.id)
    }
  }

  const satisfied = new Set(baseline)
  const order: AnyPlugin[] = []
  const done = new Set<PluginId>()

  let progressing = true
  while (progressing) {
    progressing = false
    for (const plugin of byId.values()) {
      if (done.has(plugin.id)) continue
      if (!plugin.needs.every((token) => satisfied.has(serviceId(token)))) continue
      done.add(plugin.id)
      order.push(plugin)
      for (const token of serviceTokensOf(plugin.provides)) satisfied.add(serviceId(token))
      progressing = true
    }
  }

  const blocked = new Map<PluginId, CoeffectsUnmet>()
  for (const plugin of byId.values()) {
    if (done.has(plugin.id)) continue
    const missing = plugin.needs.flatMap((token) => {
      const key = serviceId(token)
      return satisfied.has(key) ? [] : [key]
    })
    blocked.set(plugin.id, new CoeffectsUnmet({ plugin: plugin.id, missing }))
  }

  // Prune blocked nodes that depend on externally-missing services.
  // A true cycle remains only when every missing dependency is provided
  // by another blocked node still in the set. Iteratively peel off the
  // externally-grounded fringe; what remains (if any) is the cycle core.
  const remaining = new Set(blocked.keys())
  let pruned = true
  while (pruned) {
    pruned = false
    for (const id of [...remaining]) {
      const plugin = byId.get(id)
      if (plugin === undefined) continue
      const hasExternalDep = plugin.needs.some((token) => {
        const key = serviceId(token)
        if (satisfied.has(key)) return false
        const owner = providerIndex.get(key)
        return owner === undefined || !remaining.has(owner)
      })
      if (hasExternalDep) {
        remaining.delete(id)
        pruned = true
      }
    }
  }
  if (remaining.size > 0) return Result.fail(new GraphCycle({ plugins: [...remaining] }))

  return Result.succeed({ order, blocked })
}
