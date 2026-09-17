import { Context, Effect, Option } from 'effect'
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
 * deactivating a bridge changes the answer immediately.
 *
 * The host's configured default is the registry's own input, not a plugin's:
 * resolving `config.json` is the host process's job (ADR-0012), and a harness
 * plugin must stay generic.
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

const setup =
  (defaults: HarnessDefaults) =>
  (ctx: PluginContext): Effect.Effect<Context.Context<Harnesses>> =>
    Effect.succeed(Context.make(Harnesses, openHarnesses(ctx, defaults)))

/** The registry for one host, built with that host's configured defaults. */
export const harnessRegistryPlugin = (defaults: HarnessDefaults = {}) =>
  definePlugin({
    id: 'oru/harness-registry',
    provides: [Harnesses],
    server: { setup: setup(defaults) },
  })
