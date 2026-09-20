import { Effect, Option, Schema } from 'effect'
import { definePlugin, type PluginContext } from '@oru/kernel'
import {
  HarnessKind,
  Harnesses,
  type HarnessDefaults,
  type HarnessEntry,
  type HarnessesContract,
} from '@oru/harness'

/**
 * `oru/harness-registry`, the live list of harnesses this host has.
 *
 * A harness plugin contributes its service under `HarnessKind`, so several
 * bridges are active at once without colliding on a service token (ADR-0006).
 * Nothing is cached: the contributions are read per call, so activating or
 * deactivating a bridge changes what the picker offers without a restart.
 *
 * The host's configured default arrives as the plugin's `Config`: plain data
 * from the composition root's resolved `config.json`, or a test literal.
 * Resolving settings stays the host process's job (ADR-0012), and a harness
 * plugin stays generic.
 */
export const openHarnesses = (
  ctx: PluginContext,
  defaults: HarnessDefaults = {},
): HarnessesContract => {
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
    preferred: () =>
      list().pipe(
        Effect.map((entries) => {
          const chosen = defaults.harness
          if (chosen !== undefined) {
            const match = entries.find((entry) => entry.harness.meta.id === chosen)
            // A configured default that no plugin registered falls back rather
            // than leaving an unconfigured thread with no harness at all.
            if (match !== undefined) return Option.some(match)
          }
          return Option.fromNullishOr(entries[0])
        }),
      ),
    defaults: () => defaults,
  }
}

/**
 * The registry. Its defaults are the plugin's `Config`: plain data, absent
 * means no configured default, so the first registered harness wins.
 */
export const harnessRegistryPlugin = definePlugin({
  id: 'oru/harness-registry',
  Config: Schema.Struct({
    harness: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
  }),
  apply: (ctx, config) => ctx.provide(Harnesses, openHarnesses(ctx, config)),
})
