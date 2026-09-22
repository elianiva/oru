import { Effect } from 'effect'
import { definePlugin } from '@oru/kernel'
import { HarnessKind } from '@oru/harness'
import { OpenCodeConfig, envOf } from './config.ts'
import { openOpencodeHarness } from './opencode/host.ts'

/**
 * `harness-opencode`, OpenCode as an oru harness.
 *
 * OpenCode runs embedded in the host's own process through its Effect SDK:
 * no child, no socket, no password. It owns the agent loop (its session,
 * compaction, tools, steering) and oru owns the record, the tools it
 * contributes, and the turn boundary. oru's tools reach the model as proxied
 * OpenCode tools registered once per host boot. Nothing here installs, signs
 * in, or repairs OpenCode; it reports what it finds (ADR-0007).
 *
 * This module is the plugin's server facet. The host loads it through the
 * generic plugin-source loader, the same path any third-party harness uses.
 * Nothing in the host imports this module statically.
 */
export const harnessOpencodePlugin = definePlugin({
  id: 'oru/harness-opencode',
  Config: OpenCodeConfig,
  apply: (ctx, config) =>
    Effect.gen(function* () {
      // A configured env is used as-is, so a scripted test stays hermetic;
      // absent configuration the bridge runs on the process environment.
      // The embedded host opens lazily on first use into a scope the
      // activation extends, so deactivation closes it.
      const env = envOf(config.env)
      const harness = yield* openOpencodeHarness({ env })
      yield* ctx.contribute(HarnessKind.of(harness.service))
    }),
})

export default harnessOpencodePlugin
