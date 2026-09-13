import { Context, Effect, Option } from 'effect'
import { definePlugin, type PluginContext } from '@oru/kernel'
import { HarnessKind, Harnesses, type HarnessEntry, type HarnessesContract } from '@oru/harness'

/**
 * `oru/harness-registry`, the live list of harnesses this host has.
 *
 * A harness plugin contributes its service under `HarnessKind`, so several
 * bridges are active at once without colliding on a service token (ADR-0006).
 * Nothing is cached: the contributions are read per call, so activating or
 * deactivating a bridge changes the answer immediately.
 */
export const openHarnesses = (ctx: PluginContext): HarnessesContract => {
  // Read live: the contribution set is the answer, so activating or deactivating
  // a bridge changes what the picker offers without a restart.
  const list = (): Effect.Effect<readonly HarnessEntry[]> =>
    ctx.contributions(HarnessKind).pipe(
      Effect.map((entries) =>
        entries
          .map((entry): HarnessEntry => ({ plugin: entry.plugin, harness: entry.value }))
          // Sorted by plugin id so "the default harness" is the same answer
          // every time, whatever order the plugins happened to activate in.
          .sort((left, right) => left.plugin.localeCompare(right.plugin)),
      ),
    )

  return {
    list,
    get: (id) =>
      list().pipe(
        Effect.map((entries) =>
          Option.fromNullishOr(entries.find((entry) => entry.harness.meta.id === id)),
        ),
      ),
    preferred: () => list().pipe(Effect.map((entries) => Option.fromNullishOr(entries[0]))),
  }
}

const setup = (ctx: PluginContext) => Effect.succeed(Context.make(Harnesses, openHarnesses(ctx)))

export const harnessRegistryPlugin = definePlugin({
  id: 'oru/harness-registry',
  provides: [Harnesses],
  server: { setup },
})
