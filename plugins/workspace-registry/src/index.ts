import { Effect, Option, Schema } from 'effect'
import { definePlugin, type PluginContext } from '@oru/kernel'
import {
  WorkspaceKind,
  Workspaces,
  type WorkspaceDefaults,
  type WorkspaceEntry,
  type WorkspacesContract,
} from '@oru/workspace'

/**
 * `oru/workspace-registry`, the live list of workspace strategies this host has.
 *
 * A workspace plugin contributes its provider under `WorkspaceKind`, so several
 * strategies are active at once without colliding on a service token. Nothing
 * is cached: the contributions are read per call, so activating or
 * deactivating a provider changes what the picker offers without a restart.
 *
 * The host's configured default arrives as the plugin's `Config`: plain data
 * from the composition root's resolved settings, or a test literal.
 */
export const openWorkspaces = (
  ctx: PluginContext,
  defaults: WorkspaceDefaults = {},
): WorkspacesContract => {
  // Read live: the contribution set is the answer, so activating or deactivating
  // a provider changes what the picker offers without a restart.
  const list = (): Effect.Effect<readonly WorkspaceEntry[]> =>
    ctx.contributions(WorkspaceKind).pipe(
      Effect.map((entries) =>
        entries
          .map((entry): WorkspaceEntry => ({ plugin: entry.plugin, provider: entry.value }))
          // Sorted by plugin id so "the default provider" is the same answer
          // every time, whatever order the plugins happened to activate in.
          .sort((left, right) => left.plugin.localeCompare(right.plugin)),
      ),
    )

  return {
    list,
    get: (id) =>
      list().pipe(
        Effect.map((entries) =>
          Option.fromNullishOr(entries.find((entry) => entry.provider.meta.id === id)),
        ),
      ),
    preferred: () =>
      list().pipe(
        Effect.map((entries) => {
          const chosen = defaults.provider
          if (chosen !== undefined) {
            const match = entries.find((entry) => entry.provider.meta.id === chosen)
            // A configured default that no plugin registered falls back rather
            // than leaving an unnamed provision with no provider at all.
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
 * means no configured default, so the first registered provider wins.
 */
export const workspaceRegistryPlugin = definePlugin({
  id: 'oru/workspace-registry',
  Config: Schema.Struct({
    provider: Schema.optional(Schema.String),
  }),
  apply: (ctx, config) => ctx.provide(Workspaces, openWorkspaces(ctx, config)),
})
